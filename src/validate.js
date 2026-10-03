/**
 * Ajv validation + the structural rules JSON Schema can't express,
 * plus a repair pass so a bad LLM response never crashes the pipeline.
 *
 * Contract order of operations:
 *   1. validateDeck(deck)      → schema + structural errors
 *   2. if invalid → retry Gemini once
 *   3. if still invalid → repairDeck(deck) → validateDeck again
 */
import Ajv from 'ajv/dist/2020.js'; // 2020-12 build — schema uses $defs + $schema 2020-12
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(here, '..', 'schemas', 'carousel.schema.json');
export const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const AjvCtor = Ajv.default ?? Ajv;
const ajv = new AjvCtor({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

// Single source of truth for caps: read them back off the schema so
// repairDeck() can never drift from what Ajv enforces.
const SLIDE_PROPS = schema.$defs.slide.properties;
const cap = (field) => SLIDE_PROPS[field]?.maxLength ?? Infinity;
const MIN_SLIDES = schema.properties.slides.minItems;
const MAX_SLIDES = schema.properties.slides.maxItems;

/** Rules that depend on array position — not expressible in JSON Schema. */
export function structuralErrors(deck) {
  const errors = [];
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  if (slides.length === 0) return ['slides: must not be empty'];
  if (slides[0].type !== 'hook') {
    errors.push(`slides/0/type: first slide must be "hook", got "${slides[0].type}"`);
  }
  const last = slides.length - 1;
  if (slides[last].type !== 'cta') {
    errors.push(`slides/${last}/type: last slide must be "cta", got "${slides[last].type}"`);
  }
  slides.slice(1, last).forEach((s, i) => {
    if (s.type !== 'body') {
      errors.push(`slides/${i + 1}/type: middle slides must be "body", got "${s.type}"`);
    }
  });
  return errors;
}

export function validateDeck(deck) {
  const ok = validateSchema(deck);
  const schemaErrors = ok
    ? []
    : (validateSchema.errors ?? []).map(
        (e) => `${e.instancePath || '/'}: ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(' | ')})` : ''}`
      );
  const structural = ok ? structuralErrors(deck) : [];
  const errors = [...schemaErrors, ...structural];
  return { valid: errors.length === 0, errors };
}

/**
 * Non-blocking lint: things that pass the schema but render wrong.
 *
 * The hostile-fixture exercise established the pattern — the renderer never
 * crashed, it just produced something nobody would post. `highlight_words` is
 * the worst offender because it fails silently: an entry that matches nothing
 * simply doesn't highlight, and an entry that matches inside a longer word
 * accents a word the author never meant to accent. Neither is an error.
 *
 * Mirrors the matcher in templates/carousel.html: case-insensitive, no word
 * boundaries, but every match extended outward to the whole surrounding word.
 */
const HL_WORD_CHAR = /[\p{L}\p{N}'’]/u;

export function deckWarnings(deck) {
  const warnings = [];
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];

  slides.forEach((s, i) => {
    const words = Array.isArray(s?.highlight_words) ? s.highlight_words : [];
    if (!words.length) return;

    // Every field the template runs the highlighter over, joined the same way.
    const haystack = [s.tagline, s.heading, s.subtitle, s.body, ...(s.bullets ?? [])]
      .filter((t) => typeof t === 'string')
      .join('\n');
    const lower = haystack.toLowerCase();

    for (const w of words) {
      if (typeof w !== 'string' || !w.trim()) continue;
      const needle = w.trim().toLowerCase();

      // Scan *every* occurrence. Checking only the first is how a two-tone
      // "Explicitly" shipped past this lint while "explicit" sat cleanly in
      // the heading one line above it.
      const collateral = new Set();
      let found = false;
      for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
        found = true;
        let start = at;
        let end = at + needle.length;
        while (start > 0 && HL_WORD_CHAR.test(lower[start - 1])) start--;
        while (end < lower.length && HL_WORD_CHAR.test(lower[end])) end++;
        const whole = haystack.slice(start, end);
        if (whole.toLowerCase() !== needle) collateral.add(whole);
      }

      if (!found) {
        warnings.push(
          `slides/${i}/highlight_words: "${w}" appears nowhere on the slide — nothing will highlight`
        );
      } else if (collateral.size) {
        warnings.push(
          `slides/${i}/highlight_words: "${w}" also highlights ${[...collateral]
            .map((c) => `"${c}"`)
            .join(', ')} — it matches inside a longer word`
        );
      }
    }
  });

  return warnings;
}

/** Truncate on a word boundary, keeping room for the ellipsis. */
function clamp(str, max) {
  if (typeof str !== 'string' || str.length <= max) return str;
  const cut = str.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Last-resort fallback. Never throws: returns a deck that validates,
 * even if that means dropping content. Losing a bullet beats a 500.
 */
export function repairDeck(deck) {
  const src = deck ?? {};
  // Whitelist top-level keys: additionalProperties:false means an unknown key
  // (a stray _comment, a hallucinated field) fails validation on its own.
  const d = {};
  for (const key of Object.keys(schema.properties)) {
    if (src[key] !== undefined) d[key] = src[key];
  }

  // Nested objects have their own additionalProperties:false — sanitise them too.
  if (d.theme && typeof d.theme === 'object') {
    const allowed = schema.properties.theme.properties;
    const theme = {};
    for (const key of Object.keys(allowed)) {
      if (typeof d.theme[key] === 'string') theme[key] = clamp(d.theme[key], allowed[key].maxLength ?? Infinity);
    }
    if (theme.base_style_id && !['signature-african', 'editorial-clean', 'mono-terminal'].includes(theme.base_style_id)) {
      delete theme.base_style_id;
    }
    if (theme.layout && !['stack', 'centered', 'left-rail'].includes(theme.layout)) {
      delete theme.layout;
    }
    for (const key of ['accent_hex', 'background_hex', 'surface_hex', 'foreground_hex']) {
      if (theme[key] && !/^#[0-9a-fA-F]{6}$/.test(theme[key])) {
        const bare = theme[key].replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(bare)) theme[key] = `#${bare}`;
        else delete theme[key];
      }
    }
    d.theme = theme;
  }
  if (d.brand && typeof d.brand === 'object') {
    const allowed = schema.properties.brand.properties;
    const brand = {};
    for (const key of Object.keys(allowed)) {
      if (typeof d.brand[key] === 'string') brand[key] = clamp(d.brand[key], allowed[key].maxLength ?? Infinity);
    }
    d.brand = brand;
  }

  d.format = 'carousel';
  d.platform = ['linkedin', 'instagram'].includes(d.platform) ? d.platform : 'linkedin';
  d.aspect_ratio = '4:5';
  d.style_id = typeof d.style_id === 'string' && d.style_id.trim() ? d.style_id.trim().slice(0, 40) : 'signature-african';
  d.narrative_type = schema.properties.narrative_type.enum.includes(d.narrative_type)
    ? d.narrative_type
    : 'listicle';
  d.source = d.source === 'template' ? 'template' : 'ai';
  d.title = clamp(String(d.title || 'Untitled carousel'), schema.properties.title.maxLength);
  if (typeof d.watermark !== 'boolean') d.watermark = true;

  let slides = (Array.isArray(d.slides) ? d.slides : []).map((raw) => {
    const s = {};
    for (const key of Object.keys(SLIDE_PROPS)) if (raw?.[key] !== undefined) s[key] = raw[key];
    s.type = ['hook', 'body', 'cta'].includes(s.type) ? s.type : 'body';
    s.heading = clamp(String(s.heading || 'Untitled slide'), cap('heading'));
    for (const f of ['tagline', 'subtitle', 'body']) {
      if (s[f] !== undefined) s[f] = clamp(String(s[f]), cap(f));
    }
    if (s.bullets !== undefined) {
      const max = SLIDE_PROPS.bullets.maxItems;
      s.bullets = (Array.isArray(s.bullets) ? s.bullets : [])
        .filter((b) => typeof b === 'string' && b.trim())
        .slice(0, max)
        .map((b) => clamp(b.trim(), SLIDE_PROPS.bullets.items.maxLength));
      if (s.bullets.length === 0) delete s.bullets;
    }
    if (s.highlight_words !== undefined) {
      s.highlight_words = (Array.isArray(s.highlight_words) ? s.highlight_words : [])
        .filter((w) => typeof w === 'string' && w.trim().length >= 2)
        .slice(0, SLIDE_PROPS.highlight_words.maxItems)
        .map((w) => clamp(w.trim(), SLIDE_PROPS.highlight_words.items.maxLength));
      if (s.highlight_words.length === 0) delete s.highlight_words;
    }
    if (s.cta && typeof s.cta.label === 'string') {
      s.cta = { label: clamp(s.cta.label, SLIDE_PROPS.cta.properties.label.maxLength) };
    } else delete s.cta;
    if (s.image) {
      s.image = { source: s.image.source === 'upload' ? 'upload' : 'none', ...(s.image.ref ? { ref: String(s.image.ref) } : {}) };
    }
    if (s.page_label !== undefined) s.page_label = clamp(String(s.page_label), cap('page_label'));
    return s;
  });

  // Pad thin decks rather than failing: a placeholder slide is editable, an error is not.
  while (slides.length < MIN_SLIDES) {
    slides.push({ type: 'body', heading: `Point ${slides.length + 1}`, body: 'Add your point here.' });
  }
  if (slides.length > MAX_SLIDES) slides = slides.slice(0, MAX_SLIDES);

  slides.forEach((s, i) => {
    s.type = i === 0 ? 'hook' : i === slides.length - 1 ? 'cta' : 'body';
  });

  d.slides = slides;
  return d;
}

// CLI: node src/validate.js fixtures/sample-5.json [...]
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node src/validate.js <deck.json> [more.json ...]');
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    const deck = JSON.parse(readFileSync(file, 'utf8'));
    const { valid, errors } = validateDeck(deck);
    if (valid) {
      console.log(`PASS  ${file}  (${deck.slides.length} slides, style=${deck.style_id})`);
      deckWarnings(deck).forEach((w) => console.log(`      warn: ${w}`));
    } else {
      failed++;
      console.log(`FAIL  ${file}`);
      errors.forEach((e) => console.log(`        ${e}`));
      const { valid: repaired, errors: stillBad } = validateDeck(repairDeck(deck));
      console.log(`      repairDeck() → ${repaired ? 'now valid' : `STILL INVALID: ${stillBad.join('; ')}`}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}
