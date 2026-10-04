import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer';
import { defaultDeck } from '../src/defaults.js';

const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const routeHelpers = appJs.slice(
  appJs.indexOf('function safeReturnPath(value)'),
  appJs.indexOf('// ------------------------------------------------------------------ accounts')
);

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { app } = await import('../src/server.js');
let base;
let server;
let browser;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

test('sign-in return paths are limited to safe same-origin studio routes', () => {
  const dom = new JSDOM('', { url: 'https://storyloom.local/signin?next=%2Fstudio%2Fnew%3Fstep%3Dtemplate' });
  const { location } = dom.window;
  const helpers = new Function(
    'location',
    'window',
    `${routeHelpers}; return { safeReturnPath, signInNextPath, signInCallbackUrl, setNewFlowLocation };`
  )(location, { history: { pushState() {}, replaceState() {} } });

  assert.equal(helpers.safeReturnPath('/studio/deck/deck-123'), '/studio/deck/deck-123');
  assert.equal(helpers.safeReturnPath('/studio/new?step=template'), '/studio/new?step=template');
  assert.equal(helpers.safeReturnPath('//attacker.example/path'), null);
  assert.equal(helpers.safeReturnPath('https://attacker.example/path'), null);
  assert.equal(helpers.safeReturnPath('/studio/admin/feedback'), '/studio/admin/feedback');
  assert.equal(helpers.safeReturnPath('/studio/admin/unrecognized'), null);
  assert.equal(helpers.signInNextPath(), '/studio/new?step=template');
  assert.equal(
    new URL(helpers.signInCallbackUrl()).searchParams.get('next'),
    '/studio/new?step=template'
  );
});

test('signed-out deep links return to the requested saved deck after sign-in', async () => {
  const deck = defaultDeck('signature-african');
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const respond = (body, status = 200, contentType = 'application/json') => request.respond({
      status,
      contentType,
      headers: contentType === 'application/javascript' ? { 'access-control-allow-origin': '*' } : {},
      body: contentType === 'application/javascript' ? body : JSON.stringify(body),
    });
    const handle = async () => {
      const url = new URL(request.url());
      if (url.hostname === 'esm.sh') {
        await respond(`export function createClient() {
          let session = JSON.parse(localStorage.getItem('test-session') || 'null');
          return { auth: {
            getSession: async () => ({ data: { session } }),
            refreshSession: async () => ({ data: { session } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signInWithPassword: async () => {
              session = { user: { id: 'user-1', email: 'person@example.test' }, access_token: 'test-token' };
              localStorage.setItem('test-session', JSON.stringify(session));
              return { data: { session }, error: null };
            },
            signOut: async () => { session = null; localStorage.removeItem('test-session'); }
          } };
        }`, 200, 'application/javascript');
        return;
      }
      if (url.pathname === '/api/meta') {
        const meta = await (await fetch(`${base}/api/meta`)).json();
        meta.supabase = { url: 'https://unit.test', anonKey: 'test' };
        await respond(meta);
      } else if (url.pathname === '/api/decks') {
        await respond({ ok: true, decks: [], credits: 5, plan: 'free', defaultBrand: null });
      } else if (url.pathname === '/api/styles') {
        await respond({ ok: true, isAdmin: false, styles: [] });
      } else if (url.pathname === '/api/templates') {
        await respond({ ok: true, decks: [deck] });
      } else if (url.pathname === '/api/decks/deep-link-deck') {
        await respond({ ok: true, deck });
      } else {
        await request.continue();
      }
    };
    handle().catch((error) => request.abort().catch(() => { throw error; }));
  });

  try {
    await page.goto(`${base}/studio/deck/deep-link-deck`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'auth', { timeout: 5000 })
      .catch(async (error) => {
        console.error('signed-out route state', await page.evaluate(() => ({
          view: document.documentElement.dataset.view,
          url: location.href,
          text: document.body.innerText.slice(0, 300),
        })), pageErrors);
        throw error;
      });
    assert.equal(new URL(page.url()).pathname, '/signin');
    assert.equal(new URL(page.url()).searchParams.get('next'), '/studio/deck/deep-link-deck');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'auth');
    assert.equal(new URL(page.url()).searchParams.get('next'), '/studio/deck/deep-link-deck');

    await page.type('#authEmail', 'person@example.test');
    await page.type('#authPassword', 'correct-horse');
    await page.click('#authSubmit');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'editor'
      && document.querySelector('#deckTitle')?.value);
    assert.equal(new URL(page.url()).pathname, '/studio/deck/deep-link-deck');

    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/studio/new?step=template`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'auth');
    assert.equal(new URL(page.url()).searchParams.get('next'), '/studio/new?step=template');
    await page.type('#authEmail', 'person@example.test');
    await page.type('#authPassword', 'correct-horse');
    await page.click('#authSubmit');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compose'
      && !document.querySelector('#gallery').hidden
      && document.querySelector('#gallery .gcard'), { timeout: 7000 })
      .catch(async (error) => {
        console.error('new-flow sign-in state', await page.evaluate(() => ({
          view: document.documentElement.dataset.view,
          url: location.href,
          galleryHidden: document.querySelector('#gallery').hidden,
          gallery: document.querySelector('#gallery').innerText,
          authError: document.querySelector('#authErr').innerText,
        })), pageErrors);
        throw error;
      });
    assert.equal(new URL(page.url()).pathname, '/studio/new');
    assert.equal(new URL(page.url()).search, '?step=template');

    await page.goto(`${base}/studio/admin/templates`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'not-found');
    assert.match(await page.$eval('#viewNotFound h1', (node) => node.textContent), /isn’t available/);
    await page.goto(`${base}/studio/admin/feedback`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'not-found');
    assert.match(await page.$eval('#viewNotFound h1', (node) => node.textContent), /isn’t available/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
  }
});
