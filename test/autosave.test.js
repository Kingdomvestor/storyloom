import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const { app } = await import('../src/server.js');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let base;
let server;
let browser;
let page;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
});

after(async () => {
  await page?.close().catch(() => {});
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

test('autosave persists edits made while the first save is in flight', async () => {
  const writes = [];
  const handlerErrors = [];
  const requests = [];
  const pageErrors = [];
  let resolveCreateStarted;
  const createStarted = new Promise((resolve) => { resolveCreateStarted = resolve; });

  page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setRequestInterception(true);

  page.on('request', (request) => {
    const respondJson = (body) => request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    const handle = async () => {
      const url = new URL(request.url());
      requests.push(`${request.method()} ${url.pathname}`);
      if (url.hostname === 'esm.sh') {
        await request.respond({
          status: 200,
          contentType: 'application/javascript',
          headers: { 'access-control-allow-origin': '*' },
          body: `export function createClient() {
            const session = { user: { id: 'test-user', email: 'test@example.com' }, access_token: 'test-token' };
            return { auth: {
              getSession: async () => ({ data: { session } }),
              refreshSession: async () => ({ data: { session } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({})
            } };
          }`,
        });
        return;
      }

      if (url.pathname === '/api/meta') {
        const meta = await (await fetch(base + '/api/meta')).json();
        meta.supabase = { url: 'https://unit.test', anonKey: 'test' };
        meta.hasApiKey = true;
        await respondJson(meta);
        return;
      }
      if (url.pathname === '/api/decks' && request.method() === 'GET') {
        await respondJson({
          ok: true,
          decks: [
            { id: 'existing-deck', title: 'Saved sample carousel', source: 'ai', updated_at: '2026-09-30T12:00:00.000Z' },
            { id: 'template-deck', title: 'Template sample carousel', source: 'template', updated_at: '2026-09-29T12:00:00.000Z' },
          ],
          credits: 6,
          plan: 'free',
          defaultBrand: null,
        });
        return;
      }
      if (url.pathname === '/api/validate') {
        await respondJson({ ok: true, errors: [], warnings: [] });
        return;
      }
      if (url.pathname === '/api/brands') {
        await respondJson({ ok: true, brands: [] });
        return;
      }
      if (url.pathname === '/api/generate' && request.method() === 'POST') {
        await respondJson({
          ok: true,
          deck: { ...deck, title: 'Generated sample deck', source: 'ai' },
          credits: 5,
        });
        return;
      }
      if (url.pathname === '/api/decks' && request.method() === 'POST') {
        writes.push({ method: 'POST', title: JSON.parse(request.postData()).deck.title });
        resolveCreateStarted();
        await new Promise((resolve) => setTimeout(resolve, 250));
        await respondJson({ ok: true, id: 'test-deck' });
        return;
      }
      if (url.pathname === '/api/decks/test-deck' && request.method() === 'PUT') {
        writes.push({ method: 'PUT', title: JSON.parse(request.postData()).deck.title });
        await respondJson({ ok: true, id: 'test-deck' });
        return;
      }

      await request.continue();
    };

    handle().catch((error) => {
      handlerErrors.push(error.message);
      request.abort().catch(() => {});
    });
  });

  await page.goto(base + '/studio', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const button = document.querySelector('#newDeckBtn');
    return button && getComputedStyle(button).display !== 'none';
  });
  assert.equal(await page.$eval('#brandHome', (link) => link.getAttribute('href')), '/studio');
  assert.equal(await page.$eval('.deck-open', (button) => button.getAttribute('aria-label')),
    'Open Saved sample carousel');
  assert.equal(await page.$eval('.deckcard .del', (button) => button.getAttribute('aria-label')),
    'Delete Saved sample carousel');
  assert.equal(await page.$eval('.deckcard .del svg', (icon) => icon.getAttribute('aria-hidden')),
    'true');
  const cardFooters = await page.$$eval('.deckcard', (cards) => cards.map((card) => {
    const footer = card.querySelector('.deckcard-foot');
    return {
      source: card.querySelector('.badge-source').textContent,
      hasDelete: Boolean(footer?.querySelector('.del')),
      bottomGap: Math.round(card.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom),
    };
  }));
  assert.deepEqual(cardFooters.map(({ source }) => source), ['AI generated', 'Template']);
  assert.ok(cardFooters.every(({ hasDelete, bottomGap }) => hasDelete && bottomGap <= 20));
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewport({ width: 320, height: 740 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.ok(await page.$eval('.topbar-right', (el) => el.getBoundingClientRect().right <= window.innerWidth));
  await page.setViewport({ width: 1280, height: 900 });

  const deck = {
    format: 'carousel',
    platform: 'linkedin',
    aspect_ratio: '4:5',
    style_id: 'editorial-clean',
    narrative_type: 'story',
    source: 'template',
    title: 'Initial title',
    watermark: true,
    slides: Array.from({ length: 5 }, (_, index) => ({
      type: index === 0 ? 'hook' : index === 4 ? 'cta' : 'body',
      heading: `Slide ${index + 1}`,
      page_label: `${index + 1}/5`,
    })),
  };
  await page.evaluate((value) => window.__devSeed(value), deck);
  await page.$eval('#deckTitle', (input) => {
    input.value = 'First saved version';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.setViewport({ width: 360, height: 800 });
  await page.waitForFunction(() =>
    document.querySelector('#stageFrame').getBoundingClientRect().width
    <= document.querySelector('#stage').clientWidth
  );
  const mobileEditor = await page.evaluate(() => ({
    pageFits: document.documentElement.scrollWidth <= window.innerWidth,
    toolbarFitsInternally: document.querySelector('.editbar-right').scrollWidth >= document.querySelector('.editbar-right').clientWidth,
    railFitsInternally: document.querySelector('.rail').scrollWidth >= document.querySelector('.rail').clientWidth,
    slideCount: document.querySelectorAll('.rail .rthumb').length,
    previewFitsStage: document.querySelector('#stageFrame').getBoundingClientRect().width <= document.querySelector('#stage').clientWidth,
  }));
  assert.equal(mobileEditor.pageFits, true);
  assert.equal(mobileEditor.toolbarFitsInternally, true);
  assert.equal(mobileEditor.railFitsInternally, true);
  assert.equal(mobileEditor.slideCount, 5);
  assert.equal(mobileEditor.previewFitsStage, true);
  await page.setViewport({ width: 1280, height: 900 });

  let timeout;
  try {
    await Promise.race([
      createStarted,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Autosave did not start')), 10000);
      }),
    ]);
  } catch (error) {
    const view = await page.evaluate(() => document.documentElement.dataset.view);
    throw new Error(`${error.message}; view=${view}; requests=${JSON.stringify(requests)}; pageErrors=${JSON.stringify(pageErrors)}`);
  }
  clearTimeout(timeout);

  await page.$eval('#deckTitle', (input) => {
    input.value = 'Latest edit during save';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#autostate')?.classList.contains('saved'));

  assert.deepEqual(writes, [
    { method: 'POST', title: 'First saved version' },
    { method: 'PUT', title: 'Latest edit during save' },
  ]);
  assert.deepEqual(handlerErrors, []);

  await page.click('#brandHome');
  await page.waitForFunction(() => document.documentElement.dataset.view === 'dashboard');
  assert.equal(new URL(page.url()).pathname, '/studio');

  const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  const nextTheme = originalTheme === 'dark' ? 'light' : 'dark';
  await page.click('[data-theme-toggle]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), nextTheme);
  await page.goto(base + '/');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), nextTheme);
  await page.click('[data-theme-toggle]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), originalTheme);
  await page.goto(base + '/studio');
  await page.waitForFunction(() => document.documentElement.dataset.view === 'dashboard');

  await page.click('#newDeckBtn');
  await page.waitForFunction(() => document.documentElement.dataset.view === 'compose');
  await page.$eval('#sourceText', (input) => {
    input.value = 'A short source to generate a carousel.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#generateBtn');
  await page.waitForFunction(() =>
    document.documentElement.dataset.view === 'editor'
    && document.querySelector('#deckTitle')?.value === 'Generated sample deck'
  );
  await page.waitForFunction(() => document.querySelector('#autostate')?.classList.contains('saved'));
  assert.deepEqual(writes[2], { method: 'POST', title: 'Generated sample deck' });
});