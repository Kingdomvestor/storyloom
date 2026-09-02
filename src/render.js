/**
 * render.js — deck JSON → one PNG per slide, via Puppeteer.
 *
 * Loads the SAME templates/carousel.html the browser editor uses, so what
 * exports is what the user saw. Renders one slide at a time into a viewport
 * fixed at the exact export size, waits for the template's dataset.ready
 * signal (fonts loaded + layout settled), then screenshots.
 *
 *   node src/render.js fixtures/sample-5.json
 *   node src/render.js fixtures/sample-5.json out/dev
 */
import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { validateDeck, repairDeck } from './validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(here, '..', 'templates', 'carousel.html');
const WIDTH = 1080;
const HEIGHT = 1350;
const READY_TIMEOUT_MS = 15000;

/**
 * Render a deck to one PNG per slide.
 *
 * `opts.browser` lets a long-lived process (the Express server) hand in a
 * browser it already owns. Launching Chrome costs ~700ms and a fresh profile
 * directory per call, and three back-to-back launches failed once on Sept 1 for
 * reasons never identified — so the server keeps one instance and passes it in.
 * An injected browser is never closed here; whoever opened it owns its lifetime.
 */
export async function renderDeck(deck, outDir, { browser: injected } = {}) {
  mkdirSync(outDir, { recursive: true });

  const browser =
    injected ??
    (await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
    }));
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.warn('  [page error]', e.message));

    await page.goto(pathToFileURL(TEMPLATE).href, { waitUntil: 'networkidle0' });

    const count = await page.evaluate((d) => window.STORYLOOM.setDeck(d), deck);
    const files = [];
    for (let i = 0; i < count; i++) {
      await page.evaluate((idx) => window.STORYLOOM.renderSlide(idx), i);
      await page.waitForFunction(
        () => document.documentElement.dataset.ready === 'true',
        { timeout: READY_TIMEOUT_MS }
      );
      const file = join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      files.push(file);
      if (!injected) process.stdout.write(`  ✓ slide ${i + 1}/${count}\r`);
    }
    if (!injected) console.log(`  ✓ ${count} slides                `);
    return files;
  } finally {
    // Close the page either way — a leaked page in the shared browser is a leak
    // that never gets collected, because the browser itself never closes.
    if (page) await page.close().catch(() => {});
    if (!injected) await browser.close();
  }
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('usage: node src/render.js <deck.json> [outDir]');
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(input, 'utf8'));

  // Mirror the production contract: validate, and if the deck is bad, repair
  // rather than crash — the renderer must never be the thing that 500s.
  let deck = raw;
  const { valid, errors } = validateDeck(raw);
  if (!valid) {
    console.warn(`  ! deck invalid (${errors.length} error${errors.length > 1 ? 's' : ''}) — repairing:`);
    errors.slice(0, 6).forEach((e) => console.warn(`      ${e}`));
    deck = repairDeck(raw);
    const after = validateDeck(deck);
    if (!after.valid) { console.error('  ✗ unrepairable:', after.errors.join('; ')); process.exit(1); }
  }

  const outDir = process.argv[3]
    ? resolve(process.argv[3])
    : join(here, '..', 'out', basename(input, extname(input)));

  console.log(`rendering ${input}  →  ${outDir}  [${deck.style_id}]`);
  const t = Date.now();
  await renderDeck(deck, outDir);
  console.log(`  done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
