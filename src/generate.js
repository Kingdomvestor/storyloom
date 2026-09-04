/**
 * Path A — source text → validated deck, via Gemini structured output.
 *
 * Contract: this function does not throw for anything the model does. A refusal,
 * a truncated response, malformed JSON, a 60-character heading — all of it comes
 * back as a result object the caller can turn into an HTTP status. The reason is
 * that this sits behind POST /api/generate, and an unhandled rejection there is
 * a 500 with a stack trace in the user's face.
 *
 * Escalation ladder, in order, stopping at the first success:
 *   1. call Gemini with the derived response schema
 *   2. invalid?  → one retry, with Ajv's own error strings fed back verbatim
 *   3. still invalid? → repairDeck(), which always produces something valid
 *   4. flag degraded: true so the caller knows step 3 happened
 *
 * Only 3 can lose content, and it loses it by truncating — never by failing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { schema, validateDeck, repairDeck, deckWarnings } from './validate.js';
import { toGeminiSchema } from './gemini-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(here, '..', 'prompts', 'v1.md');

/**
 * Load .env before any of the constants below read process.env.
 *
 * This used to happen lazily inside apiKey(), i.e. during the first call — long
 * after MODEL, TEMPERATURE and TIMEOUT_MS had already been evaluated at module
 * load. The key worked (it is read at call time) so nothing looked broken, but
 * every other GEMINI_* variable in .env was silently ignored. Found on Sept 2
 * when GEMINI_MODEL=gemini-3.5-flash had no effect whatsoever.
 *
 * Guarded on the key so a production host that supplies real env vars and has
 * no .env file doesn't take the exception on every boot.
 */
if (!process.env.GEMINI_API_KEY) {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env — apiKey() returns '' and generateDeck answers with no_api_key */
  }
}

export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE ?? 0.7);
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 16384);
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 60_000);

const MIN_SLIDES = schema.properties.slides.minItems;
const MAX_SLIDES = schema.properties.slides.maxItems;
const STYLES = schema.properties.style_id.enum;
const NARRATIVES = schema.properties.narrative_type.enum;
const PLATFORMS = schema.properties.platform.enum;

/**
 * Fields the model authors. Everything else on the deck is set by the app:
 * style_id and platform come from the user's pickers, brand from the brands
 * table, source/format/aspect_ratio are constants. Handing those to the model
 * spends tokens inventing values we immediately overwrite.
 *
 * `image` is omitted on purpose and it is not an oversight — the model must
 * never author imagery, and the surest way to enforce that is to give it
 * nowhere to put it. `page_label` is numbering, which is arithmetic, not writing.
 */
const AUTHORED_KEYS = ['title', 'slides'];
const WITHHELD_FROM_MODEL = ['slides.items.image', 'slides.items.page_label'];

/** Built once at module load — the shape never varies per request. */
export const responseSchema = toGeminiSchema(schema, {
  pick: AUTHORED_KEYS,
  omit: WITHHELD_FROM_MODEL,
});

/**
 * The response shape for a single-slide rewrite: `{ slide: {...} }`.
 *
 * Built by wrapping the root schema rather than by handing `schema.$defs.slide`
 * to the converter directly, because `$ref`/`$defs` are hard 400s at the API and
 * the converter resolves them against whatever root it is given. Spreading the
 * root keeps `$defs` in place for that resolution; only `properties` changes.
 *
 * `type` is withheld along with image and page_label: a slide's type is its
 * position in the deck (slot 0 hook, last cta), which lint and repairDeck decide.
 * Letting the model return one would just be a value we overwrite.
 */
export const slideResponseSchema = toGeminiSchema(
  { ...schema, properties: { slide: { $ref: '#/$defs/slide' } }, required: ['slide'] },
  { omit: ['slide.type', 'slide.image', 'slide.page_label'] }
);

/** The slide keys a rewrite is allowed to replace — everything the model authors. */
const REWRITABLE_KEYS = [
  'tagline',
  'heading',
  'subtitle',
  'body',
  'bullets',
  'highlight_words',
  'cta',
];

// ---------------------------------------------------------------- prompt build

/**
 * Render the field budgets straight off the schema so the prompt and Ajv can
 * never disagree about a cap. Hardcoding "max 60 characters" in the markdown is
 * how you get a model writing to a limit that moved three commits ago.
 */
function describeBudgets({ includeTitle = true } = {}) {
  const slide = schema.$defs.slide.properties;
  const required = new Set(schema.$defs.slide.required);
  const lines = includeTitle
    ? [`- \`title\` — max ${schema.properties.title.maxLength} characters`]
    : [];

  for (const [name, def] of Object.entries(slide)) {
    if (WITHHELD_FROM_MODEL.includes(`slides.items.${name}`)) continue;
    const label = `\`slide.${name}\``;
    const req = required.has(name) ? ' (required on every slide)' : '';

    if (def.type === 'array') {
      const item = def.items ?? {};
      const range =
        item.minLength && item.maxLength
          ? `${item.minLength}–${item.maxLength}`
          : `max ${item.maxLength}`;
      lines.push(`- ${label} — up to ${def.maxItems} items, each ${range} characters${req}`);
    } else if (def.type === 'string') {
      const range =
        def.minLength > 1 && def.maxLength
          ? `${def.minLength}–${def.maxLength} characters`
          : `max ${def.maxLength} characters`;
      lines.push(`- ${label} — ${range}${req}`);
    } else if (name === 'cta') {
      const cap = def.properties.label.maxLength;
      lines.push(`- \`slide.cta.label\` — max ${cap} characters, on the final slide only`);
    } else if (def.enum) {
      lines.push(`- ${label} — one of: ${def.enum.join(', ')}${req}`);
    }
  }
  return lines.join('\n');
}

const PROMPT_TEMPLATE = readFileSync(PROMPT_PATH, 'utf8');

function buildSystemInstruction({ slideCount, narrativeType, platform }) {
  const countPhrase =
    slideCount === 'auto'
      ? `between ${MIN_SLIDES} and ${MAX_SLIDES} slides — pick the number the source text genuinely supports, and do not pad to reach a rounder figure`
      : `${slideCount} slides`;

  return PROMPT_TEMPLATE.replace('{{FIELD_BUDGETS}}', describeBudgets())
    .replace('{{SLIDE_COUNT}}', countPhrase)
    .replace('{{NARRATIVE_TYPE}}', narrativeType)
    .replace('{{PLATFORM}}', platform);
}

// ------------------------------------------------------------------- transport

function apiKey() {
  // .env is loaded at module load (see the block near the top), so by here the
  // variable is either present or genuinely absent.
  return process.env.GEMINI_API_KEY ?? '';
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_BASE_MS = Number(process.env.GEMINI_RETRY_BASE_MS ?? 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * How long to wait before retrying. Free-tier 503s ("high demand") are the
 * common case and they do not clear in half a second, so the growth factor is
 * 3 rather than 2 — 1s then 3s. Retry-After wins when the API sends one,
 * because that is the server telling us what it actually wants.
 */
function retryDelay(attempt, response) {
  const header = Number(response?.headers?.get('retry-after'));
  if (Number.isFinite(header) && header > 0 && header <= 30) return header * 1000;
  return RETRY_BASE_MS * 3 ** (attempt - 1);
}

/** Strip a ```json fence if the model adds one despite responseMimeType. */
function unfence(text) {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * One Gemini call, with retries for transport-level failure only.
 * Returns { ok: true, text, finishReason, usage } or { ok: false, kind, message }.
 */
async function callGemini({ system, contents, model, attempts = 3, format = responseSchema }) {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      kind: 'no_api_key',
      message: 'GEMINI_API_KEY is not set. Add it to .env (see .env.example).',
    };
  }

  let lastMessage = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: format,
            temperature: TEMPERATURE,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Network drop, DNS failure, or our own timeout — all worth one more try.
      lastMessage = err.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS}ms` : err.message;
      if (attempt < attempts) {
        await sleep(retryDelay(attempt));
        continue;
      }
      return { ok: false, kind: 'network_error', message: lastMessage };
    }

    const raw = await response.text();

    if (!response.ok) {
      let message = raw.slice(0, 500);
      try {
        message = JSON.parse(raw).error?.message ?? message;
      } catch {
        /* non-JSON error body — keep the raw slice */
      }
      if (RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
        await sleep(retryDelay(attempt, response));
        lastMessage = message;
        continue;
      }
      return { ok: false, kind: 'http_error', status: response.status, message };
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return { ok: false, kind: 'bad_envelope', message: 'Gemini returned a non-JSON envelope.' };
    }

    const candidate = payload.candidates?.[0];
    const finishReason = candidate?.finishReason ?? 'UNKNOWN';
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');

    // A safety block or a recitation stop yields no usable text at all.
    if (!text) {
      const blocked = payload.promptFeedback?.blockReason;
      return {
        ok: false,
        kind: blocked ? 'blocked' : 'empty_response',
        message: blocked
          ? `Gemini blocked the prompt (${blocked}).`
          : `Gemini returned no text (finishReason: ${finishReason}).`,
        finishReason,
      };
    }

    // MAX_TOKENS on a thinking model means the JSON is cut mid-string. Reported
    // rather than retried: the same request will truncate identically.
    if (finishReason === 'MAX_TOKENS') {
      return {
        ok: false,
        kind: 'truncated',
        message: `Response hit maxOutputTokens (${MAX_OUTPUT_TOKENS}). Raise GEMINI_MAX_OUTPUT_TOKENS or ask for fewer slides.`,
        finishReason,
        text,
      };
    }

    return { ok: true, text, finishReason, usage: payload.usageMetadata ?? null };
  }

  return { ok: false, kind: 'network_error', message: lastMessage || 'exhausted retries' };
}

// -------------------------------------------------------------------- assembly

/** Merge the model's words with the fields the application owns. */
function assemble(authored, opts) {
  const slides = Array.isArray(authored?.slides) ? authored.slides : [];
  const n = slides.length;

  const deck = {
    format: 'carousel',
    platform: opts.platform,
    aspect_ratio: '4:5',
    style_id: opts.style_id,
    narrative_type: opts.narrative_type,
    source: 'ai',
    title: authored?.title ?? 'Untitled carousel',
    watermark: opts.watermark,
    slides: slides.map((s, i) => ({
      ...s,
      // Positional truth wins. The model usually gets these right, but the
      // template's layout depends on them, so they are not left to chance.
      type: i === 0 ? 'hook' : i === n - 1 ? 'cta' : 'body',
      ...(opts.pageLabels ? { page_label: `${i + 1}/${n}` } : {}),
    })),
  };
  if (opts.theme) deck.theme = opts.theme;
  if (opts.brand) deck.brand = opts.brand;
  return deck;
}

// ---------------------------------------------------------------- public entry

/**
 * @param {object} input
 * @param {string} input.text              source material the deck is written from
 * @param {number|'auto'} [input.slide_count='auto']
 * @param {string} [input.narrative_type='listicle']
 * @param {string} [input.style_id='signature-african']
 * @param {string} [input.platform='linkedin']
 * @param {object} [input.brand]           { name, handle, logo_url } — injected, not authored
 * @param {object} [input.theme]
 * @param {boolean} [input.watermark=true]
 * @param {boolean} [input.page_labels=true]
 * @param {string} [input.instructions]    extra user steer, appended to the source
 * @param {string} [input.model]
 * @returns {Promise<{ok: true, deck: object, degraded: boolean, attempts: number, notes: string[], usage: object|null}
 *                 | {ok: false, kind: string, message: string, notes: string[], attempts: number}>}
 */
export async function generateDeck(input = {}) {
  const notes = [];
  const text = String(input.text ?? '').trim();
  if (!text) {
    return { ok: false, kind: 'no_input', message: 'No source text provided.', notes, attempts: 0 };
  }

  const opts = {
    platform: PLATFORMS.includes(input.platform) ? input.platform : PLATFORMS[0],
    style_id: STYLES.includes(input.style_id) ? input.style_id : STYLES[0],
    narrative_type: NARRATIVES.includes(input.narrative_type)
      ? input.narrative_type
      : NARRATIVES[0],
    watermark: input.watermark !== false,
    pageLabels: input.page_labels !== false,
    brand: input.brand,
    theme: input.theme,
  };

  const slideCount =
    input.slide_count === 'auto' || input.slide_count == null
      ? 'auto'
      : Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Math.round(Number(input.slide_count))));

  const model = input.model || MODEL;
  const system = buildSystemInstruction({
    slideCount,
    narrativeType: opts.narrative_type,
    platform: opts.platform,
  });

  const userTurn = [
    'Source text:',
    '"""',
    text,
    '"""',
    input.instructions ? `\nAdditional direction from the user: ${input.instructions}` : '',
  ]
    .join('\n')
    .trim();

  const contents = [{ role: 'user', parts: [{ text: userTurn }] }];
  let usage = null;
  let attempts = 0;

  // Two content attempts: the first cold, the second with Ajv's complaints in
  // hand. A third would mostly re-buy the second's outcome at another 8 seconds.
  for (let pass = 1; pass <= 2; pass++) {
    attempts = pass;
    const call = await callGemini({ system, contents, model });
    if (!call.ok) {
      return { ok: false, kind: call.kind, message: call.message, notes, attempts };
    }
    usage = call.usage ?? usage;

    let authored;
    try {
      authored = JSON.parse(unfence(call.text));
    } catch (err) {
      notes.push(`pass ${pass}: response was not parseable JSON (${err.message})`);
      if (pass === 2) break;
      contents.push(
        { role: 'model', parts: [{ text: call.text }] },
        {
          role: 'user',
          parts: [
            {
              text: `That was not valid JSON: ${err.message}\nReturn the corrected object only, with no commentary and no code fence.`,
            },
          ],
        }
      );
      continue;
    }

    const deck = assemble(authored, opts);
    const { valid, errors } = validateDeck(deck);
    if (valid) {
      if (pass > 1) notes.push(`valid on retry (pass ${pass})`);
      // Lint separately from validation: a dud highlight word is not worth a
      // retry (it degrades to plain text, which is fine) but the caller should
      // know, because it is invisible in the rendered PNG.
      notes.push(...deckWarnings(deck));
      return { ok: true, deck, degraded: false, attempts, notes, usage };
    }

    notes.push(`pass ${pass}: ${errors.length} validation error(s) — ${errors.join('; ')}`);
    if (pass === 2) break;

    contents.push(
      { role: 'model', parts: [{ text: call.text }] },
      {
        role: 'user',
        parts: [
          {
            text: [
              'That response was rejected by the schema validator:',
              ...errors.map((e) => `  • ${e}`),
              '',
              'Fix every error above and return the corrected object only.',
              'Character limits are hard limits — shorten the wording rather than trimming a word off the end.',
            ].join('\n'),
          },
        ],
      }
    );
  }

  // Both passes failed validation. Repair rather than surface an error: a deck
  // with one truncated bullet is something the user can edit, an error is not.
  const lastText = contents.filter((c) => c.role === 'model').at(-1)?.parts?.[0]?.text;
  let salvaged = null;
  try {
    salvaged = JSON.parse(unfence(lastText ?? '{}'));
  } catch {
    /* unparseable — repairDeck builds a placeholder deck from nothing */
  }

  const repaired = repairDeck(assemble(salvaged ?? {}, opts));
  const { valid, errors } = validateDeck(repaired);
  if (valid) {
    notes.push('repairDeck() salvaged the response — some text may be truncated');
    return { ok: true, deck: repaired, degraded: true, attempts, notes, usage };
  }

  // Should be unreachable: repairDeck is written to always produce a valid deck.
  notes.push(`repairDeck() failed: ${errors.join('; ')}`);
  return {
    ok: false,
    kind: 'unrepairable',
    message: 'Could not produce a valid deck after two attempts and a repair pass.',
    notes,
    attempts,
  };
}

// --------------------------------------------------------------- slide rewrite

/**
 * The AI tab's presets. They live here, next to the prompt, rather than in the
 * browser: the wording *is* prompt engineering, and a copy in app.js would be a
 * second place to edit the day one of them turns out to over-trim. /api/meta
 * hands the list to the UI, which renders one button per entry.
 */
export const REWRITE_PRESETS = [
  {
    id: 'punchier',
    label: 'Punchier',
    instruction:
      'Tighten it. Stronger verbs, no hedging, no filler adjectives. Same meaning, fewer words.',
  },
  {
    id: 'simpler',
    label: 'Simpler',
    instruction:
      'Plain words and shorter sentences. A smart reader from outside this field should follow it without rereading.',
  },
  {
    id: 'shorter',
    label: 'Shorter',
    instruction:
      'Cut about a third of the words. Drop the least load-bearing sentence rather than shaving a word off every line.',
  },
  {
    id: 'bullets',
    label: 'To bullets',
    instruction:
      'Turn the body copy into 2 to 4 bullets, each a complete thought. Return `body` empty if the bullets replace it.',
  },
  {
    id: 'highlights',
    label: 'Pick highlights',
    instruction:
      'Change no wording at all. Return the text exactly as given and only choose highlight_words: one to three short phrases that already appear in this slide and carry its point.',
  },
];

const SLIDE_CAPS = schema.$defs.slide.properties;

/** The subset of a slide the model is shown — the words, not the plumbing. */
function pickRewritable(slide) {
  return Object.fromEntries(REWRITABLE_KEYS.filter((k) => k in slide).map((k) => [k, slide[k]]));
}

/**
 * Merge a model-returned slide over the original, clamped to the schema's caps.
 *
 * Same instinct as brands.js `normalise()`: clamp in JS against the schema
 * rather than hand a possibly-oversized field to Ajv and deal with the rejection.
 * A rewrite that comes back one character long is a truncation the user can see
 * and fix; a rejected request is a button that did nothing.
 *
 * Absent keys are left alone on purpose. A model that echoes only what it
 * changed must not silently delete the tagline the user typed — but a key
 * returned *empty* is an explicit clear, which is how "To bullets" empties body.
 */
function mergeRewrite(previous, next, notes) {
  const merged = { ...previous };
  const text = (v, cap) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);

  for (const key of REWRITABLE_KEYS) {
    if (!(key in next)) continue;
    const def = SLIDE_CAPS[key];

    if (key === 'cta') {
      // Which slide carries the cta is the app's decision (last slot), so a
      // rewritten label is welcome and an invented cta is not.
      const label = text(next.cta?.label, def.properties.label.maxLength);
      if (previous.cta && label) merged.cta = { label };
      continue;
    }

    if (def.type === 'array') {
      const items = (Array.isArray(next[key]) ? next[key] : [])
        .map((v) => text(v, def.items.maxLength))
        .filter((v) => v.length >= (def.items.minLength ?? 1))
        .slice(0, def.maxItems);
      if (items.length) merged[key] = items;
      else delete merged[key];
      continue;
    }

    const value = text(next[key], def.maxLength);
    if (value.length >= (def.minLength ?? 1)) merged[key] = value;
    else delete merged[key];
  }

  if (!merged.heading) {
    merged.heading = previous.heading;
    notes.push('the rewrite came back with no heading — kept the original');
  }
  return clampHighlights(merged, notes);
}

/**
 * A highlight word only does anything if it appears in the text being rendered —
 * the template highlights by substring match. Enforcing that here, rather than
 * leaving it to lint, is what makes the "Pick highlights" preset trustworthy:
 * the alternative is a word that quietly renders as plain text and looks like
 * the feature is broken.
 */
function clampHighlights(slide, notes) {
  if (!slide.highlight_words?.length) return slide;
  const haystack = [slide.tagline, slide.heading, slide.subtitle, slide.body, ...(slide.bullets ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const kept = slide.highlight_words.filter((w) => haystack.includes(w.toLowerCase()));
  const dropped = slide.highlight_words.length - kept.length;
  if (dropped) notes.push(`dropped ${dropped} highlight word(s) that are not in the slide text`);
  if (kept.length) slide.highlight_words = kept;
  else delete slide.highlight_words;
  return slide;
}

const REWRITE_SYSTEM = [
  'You are editing ONE slide of a social carousel. Return that slide only.',
  '',
  'Rules:',
  '- Keep the slide making the same point. This is a rewrite, not a new idea.',
  '- The character budgets below are hard limits enforced by a validator.',
  '  Rephrase to fit rather than trimming a word off the end.',
  '- Return only the fields that should exist afterwards. A field you leave out',
  '  keeps what the user already wrote; a field you return empty is cleared.',
  '- highlight_words must appear verbatim in the text you return, or they render',
  '  as plain text and the highlight is lost.',
  '- No markdown, no surrounding quotes, no emoji the original did not have.',
  '',
  'Field budgets:',
  describeBudgets({ includeTitle: false }),
].join('\n');

/**
 * Rewrite one slide. Returns `{ ok: true, slide, changed, notes, usage }`.
 *
 * Deliberately narrower than generateDeck(): no validation retry loop. One slide
 * is cheap to lose and the user is sitting in front of the button — clicking it
 * again is a better answer than spending a second call, and every field comes
 * back clamped anyway, so there is nothing for a retry to fix.
 */
export async function rewriteSlide(input = {}) {
  const notes = [];
  const slide = input.slide;
  if (!slide || typeof slide !== 'object' || Array.isArray(slide)) {
    return { ok: false, kind: 'bad_deck', message: 'No slide to rewrite.', notes };
  }
  const preset = REWRITE_PRESETS.find((p) => p.id === input.preset);
  const steer = String(input.instruction ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!preset && !steer) {
    return { ok: false, kind: 'no_input', message: 'Pick a preset or type an instruction.', notes };
  }

  // Deck-level context so the rewrite lands in the same voice as its neighbours.
  const where = [
    input.title ? `Deck title: ${input.title}` : null,
    input.narrative_type ? `Narrative: ${input.narrative_type}` : null,
    input.platform ? `Platform: ${input.platform}` : null,
    input.index != null && input.total
      ? `This is slide ${Number(input.index) + 1} of ${input.total}, a ${slide.type ?? 'body'} slide.`
      : `This is a ${slide.type ?? 'body'} slide.`,
  ].filter(Boolean);

  const userTurn = [
    ...where,
    '',
    'Current slide:',
    JSON.stringify(pickRewritable(slide), null, 2),
    '',
    'What to change:',
    [preset?.instruction, steer].filter(Boolean).join('\n'),
  ].join('\n');

  const call = await callGemini({
    system: REWRITE_SYSTEM,
    contents: [{ role: 'user', parts: [{ text: userTurn }] }],
    model: input.model || MODEL,
    format: slideResponseSchema,
    attempts: 2,
  });
  if (!call.ok) return { ok: false, kind: call.kind, message: call.message, notes };

  let parsed;
  try {
    parsed = JSON.parse(unfence(call.text));
  } catch (err) {
    return {
      ok: false,
      kind: 'parse_error',
      message: `The rewrite was not parseable JSON (${err.message}).`,
      notes,
    };
  }
  // Tolerate an unwrapped slide: structured output makes `{ slide: {...} }` the
  // norm, but a model that returns the slide bare is right about the content.
  const next = parsed?.slide ?? parsed;
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    return { ok: false, kind: 'parse_error', message: 'The rewrite came back empty.', notes };
  }

  const merged = mergeRewrite(slide, next, notes);
  const changed = REWRITABLE_KEYS.some(
    (k) => JSON.stringify(merged[k]) !== JSON.stringify(slide[k])
  );
  if (!changed) notes.push('the model returned this slide unchanged');
  return { ok: true, slide: merged, changed, notes, usage: call.usage ?? null };
}

// CLI: node src/generate.js "text or @file" [--slides 7] [--type how-to] [--style mono-terminal] [-o deck.json]

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const rawInput = positional[0];

  if (!rawInput) {
    console.error(
      [
        'usage: node src/generate.js "<source text>" [options]',
        '       node src/generate.js @path/to/article.txt [options]',
        '',
        `  --slides <${MIN_SLIDES}-${MAX_SLIDES}|auto>   default: auto`,
        `  --type <${NARRATIVES.join('|')}>`,
        `  --style <${STYLES.join('|')}>`,
        `  --platform <${PLATFORMS.join('|')}>`,
        '  --model <gemini-model-id>',
        '  -o <file.json>                write the deck here (default: stdout)',
      ].join('\n')
    );
    process.exit(2);
  }

  /**
   * Validate enum flags here rather than letting generateDeck() coerce them.
   *
   * Coercing is right for the HTTP path — a client sending junk should not get a
   * 400 for a field the UI cannot set wrong in the first place. At a terminal it
   * is the wrong answer: `--type how_to` (underscore, not hyphen) quietly
   * produced a listicle and never mentioned that how-to had been ignored.
   */
  const pick = (name, allowed, fallback) => {
    const value = flag(name, fallback);
    if (value != null && !allowed.includes(value)) {
      console.error(`error: --${name} "${value}" is not valid. Use one of: ${allowed.join(', ')}`);
      process.exit(2);
    }
    return value;
  };

  const slides = flag('slides', 'auto');
  if (slides !== 'auto' && !Number.isFinite(Number(slides))) {
    console.error(`error: --slides "${slides}" is not a number or "auto".`);
    process.exit(2);
  }

  const text = rawInput.startsWith('@') ? readFileSync(rawInput.slice(1), 'utf8') : rawInput;
  const out = flag('o', argv.includes('-o') ? argv[argv.indexOf('-o') + 1] : undefined);

  const started = process.hrtime.bigint();
  const result = await generateDeck({
    text,
    slide_count: slides,
    narrative_type: pick('type', NARRATIVES, 'listicle'),
    style_id: pick('style', STYLES, STYLES[0]),
    platform: pick('platform', PLATFORMS, PLATFORMS[0]),
    model: flag('model', undefined),
    brand: { name: 'Storyloom', handle: '@kingdomvestor' },
  });
  const secs = (Number(process.hrtime.bigint() - started) / 1e9).toFixed(2);

  if (!result.ok) {
    console.error(`FAIL  [${result.kind}${result.status ? ` ${result.status}` : ''}] ${result.message}`);
    result.notes.forEach((n) => console.error(`      ${n}`));
    process.exit(1);
  }

  const { deck } = result;
  console.error(
    `OK    ${deck.slides.length} slides · ${result.attempts} pass(es) · ${secs}s` +
      (result.degraded ? ' · DEGRADED (repaired)' : '') +
      (result.usage ? ` · ${result.usage.totalTokenCount} tokens` : '')
  );
  result.notes.forEach((n) => console.error(`      ${n}`));

  const json = JSON.stringify(deck, null, 2);
  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, `${json}\n`);
    console.error(`      written to ${out}`);
  } else {
    console.log(json);
  }
}
