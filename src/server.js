/**
 * server.js — the Express layer over the pieces built Mon–Thu.
 *
 * Three things here are load-bearing:
 *
 * 1. `/templates` is served statically, so the preview iframe in the browser
 *    loads the *same file* Puppeteer loads. That is the whole architecture: if
 *    the front-end ever gets its own copy of the layout, WYSIWYG dies quietly.
 *
 * 2. One persistent Puppeteer browser, lazily launched and reused. A launch per
 *    request costs ~700ms and a fresh profile dir; three back-to-back launches
 *    also failed once on Sept 1 for reasons never identified. Keeping one
 *    instance is both faster and designs that failure mode away.
 *
 * 3. Every endpoint answers with the same envelope — { ok: true, ... } or
 *    { ok: false, kind, message } — because generate.js and extract.js already
 *    speak that shape and the front-end should only ever learn one.
 */
import express from 'express';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { schema, validateDeck, deckWarnings, repairDeck } from './validate.js';
import { generateDeck, rewriteSlide, REWRITE_PRESETS, MODEL } from './generate.js';
import { extractArticle } from './extract.js';
import { allDefaults, PLACEHOLDER_BRAND, STYLES } from './defaults.js';
import { renderDeck, renderDeckBuffers } from './render.js';
import { zipSync } from './zip.js';
import { imagesToPdf } from './pdf.js';
import { hasSupabase, publicConfig, getUser } from './supabase.js';
import * as credits from './credits.js';
import * as decks from './decks.js';
import * as brands from './brands.js';
import * as styleStore from './styles.js';
import * as starterTemplates from './starter-templates.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json({ limit: '2mb' })); // a 10-slide deck is ~6KB; the ceiling is for pasted articles

// ------------------------------------------------------------ browser lifetime

let browserPromise = null;

/** Lazily launch, and transparently relaunch if Chrome died under us. */
async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing?.connected) return existing;
    browserPromise = null; // it crashed or was killed — fall through and relaunch
  }
  browserPromise = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  const browser = await browserPromise;
  console.log('  chrome up');
  return browser;
}

/**
 * Renders run one at a time. Puppeteer can drive parallel pages, but each one is
 * a full 1080×1350 compositor and a burst of tabs is the fastest way to make a
 * 512MB container OOM. Serialising costs nothing at this scale.
 */
let renderQueue = Promise.resolve();
function queueRender(task) {
  const run = renderQueue.then(task, task);
  renderQueue = run.catch(() => {}); // a failed render must not poison the queue
  return run;
}

// ------------------------------------------------------------------- endpoints

const STATUS_BY_KIND = {
  // the caller's fault
  no_input: 400,
  bad_url: 400,
  unsupported_protocol: 400,
  blocked_host: 400,
  bad_deck: 400,
  bad_input: 400,
  unauthorized: 401,
  no_credits: 402,      // out of credits — "Payment Required" fits the meaning
  not_found: 404,
  // the page's fault — the request was fine, the target isn't usable
  not_html: 422,
  no_article: 422,
  too_thin: 422,
  http_error: 422,
  too_many_redirects: 422,
  parse_error: 422,
  fetch_error: 502,
  // our fault or upstream's
  no_api_key: 503,
  overloaded: 503,      // every model in the chain answered "high demand"
  network_error: 502,
  empty_response: 502,
  blocked: 502,
  truncated: 502,
  unrepairable: 500,
  render_error: 500,
  server_error: 500,
};

const fail = (res, kind, message, extra = {}) =>
  res.status(STATUS_BY_KIND[kind] ?? 500).json({ ok: false, kind, message, ...extra });

/**
 * Soft gate for the authoring surface (compose → generate → edit → render).
 * Configured with Supabase → a valid Bearer token is required and req.user is
 * set. Unconfigured → the app degrades to the single-user Week A flow: the
 * request passes through with req.user = null so nothing that worked breaks.
 */
async function requireUser(req, res, next) {
  if (!hasSupabase()) { req.user = null; return next(); }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = await getUser(token);
  if (!user) return fail(res, 'unauthorized', 'Sign in to continue.');
  req.user = user;
  next();
}

/**
 * Hard gate for account-only routes (the deck store). Always needs a real user;
 * pair it after requireUser. In degraded mode there are no accounts, so it says
 * so rather than pretending a deck store exists.
 */
function requireAccount(req, res, next) {
  if (req.user) return next();
  return fail(res, 'unauthorized',
    hasSupabase() ? 'Sign in to continue.' : 'Accounts are not configured on this server.');
}

async function requireAdmin(req, res, next) {
  if (!req.user) return fail(res, 'unauthorized', hasSupabase() ? 'Sign in to continue.' : 'Accounts are not configured on this server.');
  try {
    const ok = await styleStore.isAdmin(req.user.id);
    if (!ok) return fail(res, 'unauthorized', 'Only admins can manage styles.');
    return next();
  } catch (err) {
    console.error('admin check failed:', err);
    return fail(res, 'server_error', 'Could not verify admin access.');
  }
}

/** Wrap an async route so a thrown/rejected error becomes a JSON 500, not HTML. */
const guard = (handler) => (req, res) => handler(req, res).catch((err) => {
  console.error(`${req.method} ${req.path}:`, err);
  fail(res, 'server_error', 'Something went wrong. Try again.');
});

/**
 * Everything the UI needs to build its own controls — enums, character caps,
 * slide bounds — read straight off the schema. The front-end hardcodes none of
 * it, so a cap that changes in schemas/carousel.schema.json changes the
 * character counters on the next reload and cannot silently disagree with Ajv.
 */
app.get('/api/meta', (_req, res) => {
  const slide = schema.$defs.slide.properties;
  res.json({
    ok: true,
    model: MODEL,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    supabase: publicConfig(),
    styles: STYLES,
    narratives: schema.properties.narrative_type.enum,
    platforms: schema.properties.platform.enum,
    slides: { min: schema.properties.slides.minItems, max: schema.properties.slides.maxItems },
    caps: {
      title: schema.properties.title.maxLength,
      tagline: slide.tagline.maxLength,
      heading: slide.heading.maxLength,
      subtitle: slide.subtitle.maxLength,
      body: slide.body.maxLength,
      bullet: slide.bullets.items.maxLength,
      bullets: slide.bullets.maxItems,
      highlight_word: slide.highlight_words.items.maxLength,
      highlight_words: slide.highlight_words.maxItems,
      cta: slide.cta.properties.label.maxLength,
      brand_name: schema.properties.brand.properties.name.maxLength,
      brand_handle: schema.properties.brand.properties.handle.maxLength,
    },
    placeholderBrand: PLACEHOLDER_BRAND,
    // Labels only. The instruction text behind each preset is prompt copy and
    // stays server-side, where it is written and tuned.
    rewritePresets: REWRITE_PRESETS.map(({ id, label }) => ({ id, label })),
    exportFormats: ['png', 'zip', 'pdf'],
  });
});

/** Path B — the template gallery. No model call, no credit. */
app.get('/api/defaults', requireUser, (req, res) => {
  const brand = req.query.name || req.query.handle
    ? { name: String(req.query.name ?? ''), handle: String(req.query.handle ?? '') }
    : undefined;
  res.json({ ok: true, decks: allDefaults(brand ? { brand } : {}) });
});

app.get('/api/templates', requireUser, guard(async (req, res) => {
  const brand = req.query.name || req.query.handle
    ? { name: String(req.query.name ?? ''), handle: String(req.query.handle ?? '') }
    : undefined;
  const decks = allDefaults(brand ? { brand } : {});
  const saved = await starterTemplates.listPublished();

  for (const row of saved) {
    if (!row.deck || typeof row.deck !== 'object' || Array.isArray(row.deck)) continue;
    const deck = { ...row.deck, title: row.name, source: 'template' };
    if (validateDeck(deck).valid) decks.push(deck);
  }
  res.json({ ok: true, decks });
}));

app.post('/api/templates', requireUser, requireAccount, requireAdmin, guard(async (req, res) => {
  const body = req.body ?? {};
  const name = String(body.name ?? '').trim();
  if (!name || name.length > schema.properties.title.maxLength) {
    return fail(res, 'bad_input', `Template name must be 1-${schema.properties.title.maxLength} characters.`);
  }
  if (!body.deck || typeof body.deck !== 'object' || Array.isArray(body.deck)) {
    return fail(res, 'bad_deck', 'A valid deck is required.');
  }

  const deck = { ...body.deck, title: name, source: 'template' };
  const checked = validateDeck(deck);
  if (!checked.valid) return fail(res, 'bad_deck', `Invalid template deck: ${checked.errors.join('; ')}`);

  try {
    const template = await starterTemplates.create(req.user.id, {
      name,
      slug: body.slug,
      description: body.description,
      deck,
    });
    res.json({ ok: true, template });
  } catch (error) {
    if (error.code === '23505') return fail(res, 'bad_input', 'That template slug is already in use.');
    throw error;
  }
}));

app.get('/api/styles', requireUser, guard(async (req, res) => {
  if (!hasSupabase()) return res.json({ ok: true, isAdmin: false, styles: [] });
  const styles = await styleStore.listPublished();
  const isAdmin = req.user ? await styleStore.isAdmin(req.user.id) : false;
  res.json({ ok: true, isAdmin, styles });
}));

app.post('/api/styles', requireUser, requireAccount, requireAdmin, guard(async (req, res) => {
  const row = await styleStore.create(req.user.id, req.body ?? {});
  res.json({ ok: true, style: row });
}));

app.post('/api/extract', requireUser, async (req, res) => {
  const result = await extractArticle(req.body?.url);
  if (!result.ok) return fail(res, result.kind, result.message);
  res.json(result);
});

/**
 * Path A. Accepts `text` or `url`; a URL is extracted first and the extraction
 * meta comes back alongside the deck so the UI can say what it actually read
 * rather than leaving the user to trust it.
 */
app.post('/api/generate', requireUser, async (req, res) => {
  const body = req.body ?? {};
  let text = String(body.text ?? '').trim();
  let extracted = null;

  if (!text && body.url) {
    const article = await extractArticle(body.url);
    if (!article.ok) return fail(res, article.kind, article.message);
    text = article.text;
    extracted = {
      title: article.title,
      siteName: article.siteName,
      byline: article.byline,
      chars: article.chars,
      finalUrl: article.finalUrl,
      truncated: article.truncated,
    };
  }
  if (!text) return fail(res, 'no_input', 'Paste some text or a link first.');

  const styleId = String(body.style_id ?? STYLES[0]);
  let selectedStyle;
  try {
    selectedStyle = await styleStore.getPublishedBySlug(styleId);
  } catch (error) {
    console.error('style lookup failed:', error);
    return fail(res, 'server_error', 'Could not load that style. Try again.');
  }
  if (!selectedStyle) return fail(res, 'bad_input', 'Choose a published style before generating.');
  const theme = selectedStyle.is_system ? undefined : selectedStyle.settings;

  // Credits: spend one before the model call, refund it if generation fails.
  // Only when accounts are on — degraded mode keeps the Week A flow free.
  let remaining = null;
  if (req.user) {
    try {
      remaining = await credits.spend(req.user.id);
    } catch (err) {
      console.error('spend_credit failed:', err);
      return fail(res, 'server_error', 'Could not check your credits. Try again.');
    }
    if (remaining === null) {
      return fail(res, 'no_credits', "You're out of credits.");
    }
  }

  const started = process.hrtime.bigint();
  const result = await generateDeck({
    text,
    slide_count: body.slide_count ?? 'auto',
    narrative_type: body.narrative_type,
    style_id: styleId,
    platform: body.platform,
    watermark: body.watermark,
    brand: body.brand,
    theme,
    instructions: body.instructions,
  });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;

  if (!result.ok) {
    const notes = result.notes ?? [];
    // Say the refund out loud and send the balance back with the error. A failed
    // generation that silently keeps the credit is indistinguishable from theft,
    // and the credits pill has already been decremented in the browser.
    if (req.user) {
      const back = await credits.refund(req.user.id).catch((e) => {
        console.error('refund failed:', e);
        return null;
      });
      if (back !== null) {
        notes.push('credit refunded');
        remaining = back;
      }
    }
    return fail(res, result.kind, result.message, {
      notes,
      extracted,
      ...(remaining !== null ? { credits: remaining } : {}),
    });
  }
  res.json({
    ok: true,
    deck: result.deck,
    ...(remaining !== null ? { credits: remaining } : {}),
    degraded: result.degraded,
    attempts: result.attempts,
    notes: result.notes,
    usage: result.usage,
    seconds: Number(seconds.toFixed(2)),
    extracted,
  });
});

/** Live check for the editor: schema errors plus the non-blocking lint. */
app.post('/api/validate', requireUser, (req, res) => {
  const deck = req.body?.deck;
  if (!deck || typeof deck !== 'object') {
    return fail(res, 'bad_deck', 'No deck in the request body.');
  }
  const { valid, errors } = validateDeck(deck);
  res.json({ ok: true, valid, errors, warnings: deckWarnings(deck) });
});

/**
 * The AI tab: rewrite one slide. Costs a credit, because it is a model call and
 * a free rewrite button is a free model call in a loop.
 *
 * The client sends the slide, not the deck — the rewrite only ever touches one,
 * and generate.js clamps every field it gets back to the schema's caps, so there
 * is nothing a whole-deck round trip would catch that this doesn't.
 */
app.post('/api/rewrite', requireUser, guard(async (req, res) => {
  const body = req.body ?? {};
  if (!body.slide || typeof body.slide !== 'object') {
    return fail(res, 'bad_deck', 'No slide in the request body.');
  }

  let remaining = null;
  if (req.user) {
    try {
      remaining = await credits.spend(req.user.id);
    } catch (err) {
      console.error('spend_credit failed:', err);
      return fail(res, 'server_error', 'Could not check your credits. Try again.');
    }
    if (remaining === null) return fail(res, 'no_credits', "You're out of credits.");
  }

  const result = await rewriteSlide({
    slide: body.slide,
    preset: body.preset,
    instruction: body.instruction,
    index: body.index,
    total: body.total,
    title: body.title,
    narrative_type: body.narrative_type,
    platform: body.platform,
  });

  // Refund on failure, and also when the model handed the slide back untouched —
  // a credit spent for no change is the kind of charge that loses trust.
  const worthless = !result.ok || result.changed === false;
  if (req.user && worthless) {
    const back = await credits.refund(req.user.id).catch((e) => {
      console.error('refund failed:', e);
      return null;
    });
    if (back !== null) remaining = back;
  }
  if (!result.ok) return fail(res, result.kind, result.message, { notes: result.notes });

  if (result.changed === false) result.notes.push('credit refunded — nothing changed');
  res.json({
    ok: true,
    slide: result.slide,
    changed: result.changed,
    notes: result.notes,
    usage: result.usage,
    ...(remaining !== null ? { credits: remaining } : {}),
  });
}));

// ------------------------------------------------------------------ deck store
// Account-only. Every row is scoped by the verified user id (decks.js), so a
// deck that isn't yours is indistinguishable from one that doesn't exist.

/** Normalise + validate a deck-store payload. Reuses the one Ajv instance. */
function validated({ title, source, deck }) {
  if (!deck || typeof deck !== 'object') return { error: 'No deck in the request body.' };
  const { valid, errors } = validateDeck(deck);
  if (!valid) return { error: `Invalid deck: ${errors.join('; ')}` };
  return {
    value: {
      title: String(title ?? deck.title ?? 'Untitled').slice(0, 200),
      source: source === 'template' ? 'template' : 'ai',
      deck,
    },
  };
}

/**
 * List the signed-in user's decks, plus the three things the dashboard and the
 * editor both need on first load: the credit balance, the plan (which decides
 * whether the watermark toggle is honoured at export) and the default brand, so
 * a deck started from a template already carries the user's footer.
 */
app.get('/api/decks', requireUser, requireAccount, guard(async (req, res) => {
  const [rows, account, brand] = await Promise.all([
    decks.list(req.user.id),
    credits.profile(req.user.id),
    brands.getDefault(req.user.id),
  ]);
  res.json({
    ok: true,
    decks: rows,
    credits: account.credits,
    plan: account.plan,
    defaultBrand: brands.toDeckBrand(brand) ?? null,
  });
}));

/** Fetch one deck for the editor. */
app.get('/api/decks/:id', requireUser, requireAccount, guard(async (req, res) => {
  const row = await decks.get(req.user.id, req.params.id);
  if (!row) return fail(res, 'not_found', 'Deck not found.');
  res.json({ ok: true, deck: row.deck });
}));

/** Save a new deck. Validated with the same Ajv instance as everything else. */
app.post('/api/decks', requireUser, requireAccount, guard(async (req, res) => {
  const stored = validated(req.body ?? {});
  if (stored.error) return fail(res, 'bad_deck', stored.error);
  const id = await decks.create(req.user.id, stored.value);
  res.json({ ok: true, id });
}));

/** Overwrite an existing deck the user owns. */
app.put('/api/decks/:id', requireUser, requireAccount, guard(async (req, res) => {
  const stored = validated(req.body ?? {});
  if (stored.error) return fail(res, 'bad_deck', stored.error);
  const row = await decks.update(req.user.id, req.params.id, stored.value);
  if (!row) return fail(res, 'not_found', 'Deck not found.');
  res.json({ ok: true, id: row.id });
}));

/** Delete a deck the user owns. */
app.delete('/api/decks/:id', requireUser, requireAccount, guard(async (req, res) => {
  const gone = await decks.remove(req.user.id, req.params.id);
  if (!gone) return fail(res, 'not_found', 'Deck not found.');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------- brands
// Account-only, same scoping rule as decks. A brand is the footer identity
// authored once instead of retyped into every deck; the deck still carries a
// resolved `brand` object, because that is what the schema and the template read.

/** A brand with neither a name nor a handle renders as nothing — refuse it. */
function validBrand(body) {
  const row = brands.normalise(body ?? {});
  if (!row.name && !row.handle) return { error: 'A brand needs a name or a handle.' };
  return { value: { ...row, is_default: body?.is_default } };
}

app.get('/api/brands', requireUser, requireAccount, guard(async (req, res) => {
  res.json({ ok: true, brands: await brands.list(req.user.id) });
}));

app.post('/api/brands', requireUser, requireAccount, guard(async (req, res) => {
  const input = validBrand(req.body);
  if (input.error) return fail(res, 'bad_input', input.error);
  res.json({ ok: true, brand: await brands.create(req.user.id, input.value) });
}));

app.put('/api/brands/:id', requireUser, requireAccount, guard(async (req, res) => {
  const input = validBrand(req.body);
  if (input.error) return fail(res, 'bad_input', input.error);
  const row = await brands.update(req.user.id, req.params.id, input.value);
  if (!row) return fail(res, 'not_found', 'Brand not found.');
  res.json({ ok: true, brand: row });
}));

app.delete('/api/brands/:id', requireUser, requireAccount, guard(async (req, res) => {
  const gone = await brands.remove(req.user.id, req.params.id);
  if (!gone) return fail(res, 'not_found', 'Brand not found.');
  res.json({ ok: true });
}));

/**
 * Week A evidence: PNGs on disk, served from /out and shown in the sheet. Kept
 * alongside /api/export because the two answer different questions — this one
 * gives the browser URLs it can display, export gives the user a file.
 */
let renderSeq = 0;
app.post('/api/render', requireUser, async (req, res) => {
  const incoming = req.body?.deck;
  if (!incoming || typeof incoming !== 'object') {
    return fail(res, 'bad_deck', 'No deck in the request body.');
  }

  // Mirror the CLI contract: repair rather than refuse. The renderer is never
  // allowed to be the thing that 500s.
  let deck = incoming;
  const notes = [];
  const first = validateDeck(deck);
  if (!first.valid) {
    deck = repairDeck(deck);
    const after = validateDeck(deck);
    if (!after.valid) return fail(res, 'render_error', `Unrepairable deck: ${after.errors.join('; ')}`);
    notes.push(`deck was invalid (${first.errors.length} error(s)) and was repaired before rendering`);
  }

  const name = `web-${String(++renderSeq).padStart(3, '0')}-${deck.style_id}`;
  const outDir = join(ROOT, 'out', name);

  try {
    const started = process.hrtime.bigint();
    const files = await queueRender(async () => {
      const browser = await getBrowser();
      return renderDeck(deck, outDir, { browser });
    });
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    res.json({
      ok: true,
      dir: `out/${name}`,
      count: files.length,
      urls: files.map((_f, i) => `/out/${name}/slide-${String(i + 1).padStart(2, '0')}.png`),
      seconds: Number(seconds.toFixed(2)),
      notes,
    });
  } catch (err) {
    console.error('render failed:', err);
    fail(res, 'render_error', err.message);
  }
});

// ---------------------------------------------------------------------- export
// The download path: same renders as /api/render, but the bytes come back in the
// response with attachment headers instead of landing in out/ as URLs.

const EXPORT_FORMATS = new Set(['png', 'zip', 'pdf']);
const EXPORT_TYPES = { png: 'image/png', zip: 'application/zip', pdf: 'application/pdf' };

/** A filename an OS will accept, from whatever the user called the deck. */
function slugify(title, fallback = 'carousel') {
  const slug = String(title ?? '')
    .normalize('NFKD')            // é → e + ́ , so the accent strips instead of the letter
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || fallback;        // a title in a non-Latin script slugs to nothing
}

/**
 * POST /api/export → the file itself.
 *
 * `format`: `zip` (one PNG per slide), `pdf` (one page per slide) or `png` (a
 * single slide, chosen with `index`). The response is binary, so a failure has to
 * be decided *before* any header is written — everything that can say
 * `{ ok: false }` runs first, and res.end() is the last statement in the handler.
 *
 * Watermark: enforced here and only here. A checkbox in the browser is a request,
 * not a decision, and the export is the one moment the server has the last word.
 */
app.post('/api/export', requireUser, guard(async (req, res) => {
  const body = req.body ?? {};
  const format = String(body.format ?? 'zip').toLowerCase();
  if (!EXPORT_FORMATS.has(format)) {
    return fail(res, 'bad_input', `Unknown export format "${format}". Use png, zip or pdf.`);
  }
  if (!body.deck || typeof body.deck !== 'object') {
    return fail(res, 'bad_deck', 'No deck in the request body.');
  }

  // Same contract as /api/render: repair rather than refuse. A download button
  // that reports a schema error is a download button that does nothing.
  let deck = body.deck;
  if (!validateDeck(deck).valid) {
    deck = repairDeck(deck);
    const after = validateDeck(deck);
    if (!after.valid) return fail(res, 'render_error', `Unrepairable deck: ${after.errors.join('; ')}`);
  }

  // Degraded mode has no accounts and therefore no tiers, so it is left alone:
  // the Week A single-user flow keeps working exactly as it did.
  let forced = false;
  if (req.user) {
    const { plan } = await credits.profile(req.user.id);
    if (plan !== 'pro' && deck.watermark !== true) {
      deck = { ...deck, watermark: true };
      forced = true;
    }
  }

  const shots = await queueRender(async () => {
    const browser = await getBrowser();
    return renderDeckBuffers(deck, {
      browser,
      quiet: true,
      only: format === 'png' ? (body.index ?? 0) : undefined,
    });
  });

  const slug = slugify(deck.title);
  const stamp = new Date().toISOString().slice(0, 10);
  let bytes;
  let filename;
  if (format === 'pdf') {
    bytes = imagesToPdf(shots.map((s) => s.buffer));
    filename = `${slug}-${stamp}.pdf`;
  } else if (format === 'zip') {
    bytes = zipSync(shots.map(({ name, buffer }) => ({ name, data: buffer })));
    filename = `${slug}-${stamp}.zip`;
  } else {
    bytes = shots[0].buffer;
    filename = `${slug}-${shots[0].name}`;
  }

  res.setHeader('Content-Type', EXPORT_TYPES[format]);
  res.setHeader('Content-Length', bytes.length);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  // A binary response has nowhere to put a note, and the UI needs to be able to
  // say why the watermark is there when the toggle was off.
  res.setHeader('X-Storyloom-Watermark', forced ? 'forced' : String(Boolean(deck.watermark)));
  res.end(bytes);
}));

app.get('/api/health', async (_req, res) => {
  const browser = await browserPromise?.catch(() => null);
  res.json({
    ok: true,
    model: MODEL,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    chrome: browser?.connected ? 'up' : 'not started',
    renders: renderSeq,
  });
});

// --------------------------------------------------------------------- statics

// The iframe loads /templates/carousel.html — the same bytes Puppeteer opens
// from disk. Serving it read-only rather than copying it into public/ is what
// keeps preview and export from drifting.
app.get('/', (_req, res) => res.sendFile(join(ROOT, 'public', 'landing.html')));
app.get('/studio', (_req, res) => res.sendFile(join(ROOT, 'public', 'index.html')));
app.get('/signin', (_req, res) => res.sendFile(join(ROOT, 'public', 'index.html')));
app.use('/templates', express.static(join(ROOT, 'templates')));
app.use('/out', express.static(join(ROOT, 'out')));
app.use('/fixtures', express.static(join(ROOT, 'fixtures')));
app.use(express.static(join(ROOT, 'public')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return fail(res, 'not_found', `No such endpoint: ${req.path}`);
  res.status(404).sendFile(join(ROOT, 'public', 'index.html'));
});

// ----------------------------------------------------------------------- start

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    // Load .env for the whole server (GEMINI + Supabase). loadEnvFile never
    // overrides vars already in the real environment, so this is always safe.
    process.loadEnvFile();
  } catch {
    /* no .env — /api/meta reports hasApiKey:false / supabase:null and the UI says so */
  }

  const server = app.listen(PORT, () => {
    const keyed = process.env.GEMINI_API_KEY ? `key loaded · ${MODEL}` : 'NO API KEY — Path B only';
    console.log(`\n  Storyloom  http://localhost:${PORT}`);
    console.log(`  ${keyed}`);
    console.log(`  styles: ${STYLES.join(', ')}\n`);
    // Warm Chrome now rather than making the first render pay for it.
    getBrowser().catch((e) => console.warn('  chrome failed to start:', e.message));
  });

  const shutdown = async (signal) => {
    console.log(`\n  ${signal} — closing`);
    server.close();
    const browser = await browserPromise?.catch(() => null);
    await browser?.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

export { app, getBrowser };
