/**
 * export.test.js — /api/export and /api/rewrite, over HTTP.
 *
 * Two of these render for real, through the same Chrome and the same
 * templates/carousel.html the preview iframe uses. That is the point: the unit
 * tests feed zip.js and pdf.js synthetic PNGs, and this file is the only place
 * that proves they survive the bytes Chrome actually produces.
 *
 * Nothing here calls the model. /api/rewrite is only exercised up to the guard
 * that runs before any credit is spent — a test that costs quota is a test
 * nobody runs twice.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Same ordering as server-degraded.test.js: import first (generate.js loads .env
// at module scope), then clear the Supabase vars so requireUser stays soft and no
// account, credit or plan lookup happens.
const { app, getBrowser } = await import('../src/server.js');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const deck = JSON.parse(readFileSync(new URL('../fixtures/sample-5.json', import.meta.url), 'utf8'));

let base;
let server;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  // The app keeps one lazily-launched browser for the life of the process; the
  // test runner will not exit while it is up.
  await (await getBrowser().catch(() => null))?.close();
});

const post = (path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// ------------------------------------------------------------------ the guards
// A binary response cannot carry an error, so everything that can refuse has to
// refuse before the first byte is written — and before Chrome is launched. These
// run first in the file so the health check below still finds a cold browser.

test('an unknown format is refused as bad_input', async () => {
  const res = await post('/api/export', { format: 'nope', deck });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.kind, 'bad_input');
  assert.match(body.message, /png, zip or pdf/);
});

test('a missing deck is refused as bad_deck', async () => {
  const res = await post('/api/export', { format: 'zip' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).kind, 'bad_deck');
});

test('/api/rewrite refuses a request with no slide, before spending anything', async () => {
  const res = await post('/api/rewrite', { preset: 'punchier' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, 'bad_deck');
  // Not 401: with Supabase unconfigured the authoring surface stays open, which
  // is the whole degraded-mode contract.
  assert.notEqual(body.kind, 'unauthorized');
});

test('none of that started Chrome', async () => {
  const { chrome } = await (await fetch(base + '/api/health')).json();
  assert.equal(chrome, 'not started', 'a rejected export still paid for a browser launch');
});

// ------------------------------------------------------------- the real renders
// From here on Chrome runs. These are the slow tests, and the only ones that put
// real screenshot bytes through zip.js and pdf.js.

const SLUG = 'why-every-developer-needs-a-portfolio-site';

/** Read a binary response, asserting the headers a download needs. */
async function download(body, type) {
  const res = await post('/api/export', body);
  assert.equal(res.status, 200, `export failed: ${res.headers.get('content-type')}`);
  assert.equal(res.headers.get('content-type'), type);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(Number(res.headers.get('content-length')), bytes.length, 'Content-Length lies');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition'))?.[1];
  return {
    bytes,
    filename,
    watermark: res.headers.get('x-storyloom-watermark'),
    renderCache: res.headers.get('x-storyloom-render-cache'),
  };
}

test('a single slide comes back as a 1080x1350 PNG named for its position', async () => {
  const { bytes, filename, watermark, renderCache } = await download(
    { format: 'png', deck, index: 1 }, 'image/png');
  assert.equal(filename, `${SLUG}-slide-02.png`, 'the name must carry the real slide number');
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // IHDR is the first chunk: 8 bytes of signature, then length+type, then w and h.
  assert.equal(bytes.readUInt32BE(16), 1080, 'not the schema width');
  assert.equal(bytes.readUInt32BE(20), 1350, 'not the schema height');
  assert.equal(watermark, 'true', "the fixture asks for a watermark, so it isn't 'forced'");
  assert.equal(renderCache, 'miss');
});

test('an out-of-range index clamps to the last slide instead of failing', async () => {
  // The UI cannot send this, but a saved deck that shrank between sessions can.
  const { filename, watermark } = await download(
    { format: 'png', deck: { ...deck, watermark: false }, index: 99 }, 'image/png');
  assert.equal(filename, `${SLUG}-slide-05.png`);
  // Degraded mode has no plans, so the toggle is honoured rather than overridden.
  assert.equal(watermark, 'false');
});

test('preview reuses a partial render and exports reuse the completed preview', async () => {
  const preview = await post('/api/render', { deck });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.cached, false);
  assert.equal(previewBody.count, deck.slides.length);

  const { bytes, renderCache } = await download({ format: 'zip', deck }, 'application/zip');
  assert.equal(renderCache, 'hit');
  assert.ok(bytes.length > 0);

  const repeatedPreview = await post('/api/render', { deck });
  assert.equal(repeatedPreview.status, 200);
  assert.equal((await repeatedPreview.json()).cached, true);
});

test('the PDF has one page per slide, and pdf.js decodes what Chrome produced', async () => {
  const { bytes, filename } = await download({ format: 'pdf', deck }, 'application/pdf');
  assert.match(filename, new RegExp(`^${SLUG}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
  const text = bytes.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'), 'not a PDF');
  assert.ok(text.endsWith('%%EOF\n'), 'truncated PDF');
  assert.equal(Number(/\/Type \/Pages \/Count (\d+)/.exec(text)[1]), deck.slides.length);
  assert.equal([...text.matchAll(/\/Subtype \/Image/g)].length, deck.slides.length);
  // 1080x1350 at 540pt wide — the aspect ratio survives the round trip.
  assert.equal([...text.matchAll(/\/MediaBox \[0 0 540 675\]/g)].length, deck.slides.length);
});

test('the ZIP holds one entry per slide, named in order', async () => {
  const { bytes, filename } = await download({ format: 'zip', deck }, 'application/zip');
  assert.match(filename, new RegExp(`^${SLUG}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
  const eo = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(eo), 0x06054b50, 'no end-of-central-directory record');
  assert.equal(bytes.readUInt16LE(eo + 10), deck.slides.length);
  const names = [...bytes.toString('latin1').matchAll(/slide-(\d{2})\.png/g)].map((m) => m[1]);
  // Each name appears twice — local header and central directory.
  assert.deepEqual([...new Set(names)], ['01', '02', '03', '04', '05']);
});
