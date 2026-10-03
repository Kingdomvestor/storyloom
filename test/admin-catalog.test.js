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

test('admin catalogs filter correctly and custom styles can be archived', async () => {
  const defaults = await (await fetch(`${base}/api/defaults`)).json();
  const sampleDeck = defaults.decks[0];
  const templates = [
    { id: 'builtin:signature-african', name: sampleDeck.title, slug: sampleDeck.style_id, status: 'published', origin: 'builtin', deck: sampleDeck },
    { id: 'template-published', name: 'Published with draft', slug: 'published-draft', status: 'published', origin: 'studio', deck: sampleDeck, draft: { name: 'Published draft edit', deck: sampleDeck } },
    { id: 'template-draft', name: 'Unpublished template', slug: 'unpublished-template', status: 'draft', origin: 'studio', deck: sampleDeck },
  ];
  const styles = [
    ...['signature-african', 'editorial-clean', 'mono-terminal'].map((id) => ({
      id, name: id, slug: id, status: 'published', is_system: true, settings: {},
    })),
    { id: 'style-public', name: 'Custom Public', slug: 'custom-public', status: 'published', is_system: false, settings: { layout: 'centered' } },
    { id: 'style-draft', name: 'Custom Draft', slug: 'custom-draft', status: 'draft', is_system: false, settings: {} },
    { id: 'style-archived', name: 'Custom Archived', slug: 'custom-archived', status: 'archived', is_system: false, settings: {} },
  ];

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
          const session = { user: { id: 'admin-user', email: 'admin@example.test' }, access_token: 'test-token' };
          return { auth: {
            getSession: async () => ({ data: { session } }),
            refreshSession: async () => ({ data: { session } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signOut: async () => ({})
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
        await respond({ ok: true, isAdmin: true, styles: styles.filter((style) => style.status === 'published') });
      } else if (url.pathname === '/api/admin/templates') {
        await respond({ ok: true, templates });
      } else if (url.pathname === '/api/admin/styles') {
        await respond({ ok: true, styles });
      } else if (url.pathname.startsWith('/api/admin/styles/') && request.method() === 'PUT') {
        const id = url.pathname.split('/').pop();
        const update = JSON.parse(request.postData());
        const style = styles.find((entry) => entry.id === id);
        Object.assign(style, update, { draft: null });
        await respond({ ok: true, style });
      } else {
        await request.continue();
      }
    };
    handle().catch((error) => request.abort().catch(() => { throw error; }));
  });

  try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#adminLink.admin-ready');
    await page.click('#adminLink');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'admin'
      && document.querySelectorAll('.admin-template-row').length === 3);

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.admin-filters button')]
        .find((item) => item.textContent === 'Drafts');
      button.click();
    });
    await page.waitForFunction(() => document.querySelectorAll('.admin-template-row h2').length === 2);
    const draftTemplateNames = await page.$$eval('.admin-template-row h2', (nodes) =>
      nodes.map((node) => node.textContent));
    assert.deepEqual(draftTemplateNames.sort(), ['Published draft edit', 'Unpublished template']);

    await page.click('.admin-nav [data-admin-page="styles"]');
    await page.waitForSelector('.admin-style-row');
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.admin-filters button')]
        .find((item) => item.textContent === 'Drafts');
      button.click();
    });
    await page.waitForFunction(() => document.querySelectorAll('.admin-style-row strong').length === 1);
    const draftStyleNames = await page.$$eval('.admin-style-row strong', (nodes) =>
      nodes.map((node) => node.textContent));
    assert.deepEqual(draftStyleNames, ['Custom Draft']);

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.admin-filters button')]
        .find((item) => item.textContent === 'All');
      button.click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.admin-style-row strong')]
      .some((node) => node.textContent === 'Custom Public'));
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.admin-style-row')]
        .find((item) => item.querySelector('strong')?.textContent === 'Custom Public');
      row.querySelector('button:last-child').click();
    });
    await page.waitForFunction(() => document.querySelector('#adminMessage')?.textContent
      === 'Style archived from new uses.');
    assert.equal(styles.find((style) => style.id === 'style-public').status, 'archived');

    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
  }
});
