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
        await respondJson(meta);
        return;
      }
      if (url.pathname === '/api/decks' && request.method() === 'GET') {
        await respondJson({ ok: true, decks: [], credits: 6, plan: 'free', defaultBrand: null });
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
});