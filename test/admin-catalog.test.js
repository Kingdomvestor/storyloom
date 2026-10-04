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

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const pageErrors = [];
  let adminTemplateListRequests = 0;
  let adminStyleListRequests = 0;
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
        await respond(request.method() === 'POST'
          ? { ok: true, id: 'saved-template-id' }
          : { ok: true, decks: [], credits: 5, plan: 'free', defaultBrand: null });
      } else if (url.pathname === '/api/decks/route-test') {
        await respond({ ok: true, deck: sampleDeck });
      } else if (url.pathname === '/api/styles') {
        await respond({ ok: true, isAdmin: true, styles: styles.filter((style) => style.status === 'published') });
      } else if (url.pathname === '/api/brands') {
        await respond({ ok: true, brands: [] });
      } else if (url.pathname === '/api/validate') {
        await respond({ ok: true, errors: [], warnings: [] });
      } else if (url.pathname === '/api/admin/templates') {
        adminTemplateListRequests += 1;
        await respond({ ok: true, templates });
      } else if (url.pathname === '/api/admin/styles') {
        adminStyleListRequests += 1;
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
    assert.equal(new URL(page.url()).pathname, '/studio/admin/templates');

    const templateRequestsBeforeFilter = adminTemplateListRequests;
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.admin-filters button')]
        .find((item) => item.textContent === 'Drafts');
      button.click();
    });
    await page.waitForFunction(() => document.querySelectorAll('.admin-template-row h2').length === 2);
    const draftTemplateNames = await page.$$eval('.admin-template-row h2', (nodes) =>
      nodes.map((node) => node.textContent));
    assert.deepEqual(draftTemplateNames.sort(), ['Published draft edit', 'Unpublished template']);
    assert.equal(adminTemplateListRequests, templateRequestsBeforeFilter);

    await page.evaluate(() => {
      [...document.querySelectorAll('.admin-filters button')]
        .find((item) => item.textContent === 'Built-in').click();
    });
    await page.waitForFunction(() => document.querySelectorAll('.admin-template-row').length === 1);
    assert.equal(adminTemplateListRequests, templateRequestsBeforeFilter);
    await page.click('.admin-nav [data-admin-page="styles"]');
    await page.waitForSelector('.admin-style-row');
    await page.waitForFunction(() => document.querySelector('#adminStylePreview')
      ?.contentDocument?.documentElement.dataset.ready === 'true');
    assert.equal(new URL(page.url()).pathname, '/studio/admin/styles');
    assert.equal(await page.$eval('.admin-filters button[aria-pressed="true"]', (button) =>
      button.textContent), 'All');
    const styleRequestsBeforeFilter = adminStyleListRequests;
    await page.$eval('#adminStylePreview', (frame) => { frame.dataset.instanceToken = 'preserved'; });
    await page.click('.style-library-item[data-style-id="style-public"]');
    await page.$eval('#adminStyleForm [name="name"]', (input) => {
      input.value = 'Uncommitted style name';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const discardPrompt = new Promise((resolve) => {
      page.once('dialog', async (dialog) => {
        const message = dialog.message();
        await dialog.dismiss();
        resolve(message);
      });
    });
    await page.click('.style-library-item[data-style-id="style-draft"]');
    assert.match(await discardPrompt, /Discard your unsaved style changes/);
    assert.equal(await page.$eval('#adminStyleForm [name="name"]', (input) => input.value),
      'Uncommitted style name');
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.admin-filters button')]
        .find((item) => item.textContent === 'Drafts');
      button.click();
    });
    await page.waitForFunction(() => document.querySelectorAll('.admin-style-row strong').length === 1);
    const draftStyleNames = await page.$$eval('.admin-style-row strong', (nodes) =>
      nodes.map((node) => node.textContent));
    assert.deepEqual(draftStyleNames, ['Custom Draft']);
    assert.equal(adminStyleListRequests, styleRequestsBeforeFilter);
    assert.equal(await page.$eval('#adminStylePreview', (frame) => frame.dataset.instanceToken), 'preserved');

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.admin-filters button')]
        .find((item) => item.textContent === 'All');
      button.click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.admin-style-row strong')]
      .some((node) => node.textContent === 'Custom Public'));
    const acceptDiscardPrompt = new Promise((resolve) => {
      page.once('dialog', async (dialog) => {
        await dialog.accept();
        resolve();
      });
    });
    await page.click('.style-library-item[data-style-id="style-public"]');
    await acceptDiscardPrompt;
    const styleContract = (await (await fetch(`${base}/api/meta`)).json()).styleSettings;
    const styleControls = await page.$eval('#adminStyleForm', (form) =>
      Object.fromEntries([...form.querySelectorAll('[name]')].map((control) => [
        control.name,
        {
          type: control.type,
          maxLength: control.maxLength,
          min: control.min,
          max: control.max,
          options: [...(control.options ?? [])].map((option) => option.value),
        },
      ])));
    for (const [field, definition] of Object.entries(styleContract.fields)) {
      assert.ok(styleControls[field], `style editor exposes ${field}`);
      if (definition.maxLength) assert.equal(styleControls[field].maxLength, definition.maxLength);
      if (definition.enum) assert.deepEqual(styleControls[field].options, definition.enum);
      if (styleContract.colorFields.includes(field)) assert.equal(styleControls[field].type, 'color');
      if (definition.type === 'integer') {
        assert.equal(styleControls[field].type, 'number');
        assert.equal(Number(styleControls[field].min), definition.minimum);
        assert.equal(Number(styleControls[field].max), definition.maximum);
      }
    }
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
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(`${base}/studio/admin/styles`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'admin'
      && document.querySelector('.admin-style-row'));
    await page.goto(`${base}/studio/admin/templates`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'admin'
      && document.querySelectorAll('.admin-template-row').length === 3);
    await page.goto(`${base}/studio/deck/route-test`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((title) => document.documentElement.dataset.view === 'editor'
      && document.querySelector('#deckTitle')?.value === title, {}, sampleDeck.title);
    assert.equal(new URL(page.url()).pathname, '/studio/deck/route-test');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((title) => document.documentElement.dataset.view === 'editor'
      && document.querySelector('#deckTitle')?.value === title, {}, sampleDeck.title);
    assert.equal(new URL(page.url()).pathname, '/studio/deck/route-test');
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'dashboard');
    await page.click('#newDeckBtn');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compose'
      && !document.querySelector('#newDeckChoice').hidden);
    await page.click('#newDeckChoice [data-start-mode="template"]');
    await page.waitForSelector('#gallery .gcard');
    await page.click('#gallery .gcard');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'editor');
    await page.click('#backBtn');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compose'
      && !document.querySelector('#gallery').hidden
      && document.querySelector('#gallery .gcard'));
    await page.click('#gallery .gcard');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'editor');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compose'
      && !document.querySelector('#gallery').hidden
      && document.querySelector('#gallery .gcard'));
    await page.goto(`${base}/studio/new?step=template`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compose'
      && !document.querySelector('#gallery').hidden
      && document.querySelector('#gallery .gcard'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compose'
      && !document.querySelector('#gallery').hidden
      && document.querySelector('#gallery .gcard'));
    await page.click('#gallery .gcard');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'editor');
    assert.equal(new URL(page.url()).pathname, '/studio/new');
    assert.equal(new URL(page.url()).search, '?draft=1');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'editor');
    await page.$eval('#deckTitle', (input) => {
      input.value = 'Saved from template';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => new URL(location.href).pathname === '/studio/deck/saved-template-id');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compose'
      && !document.querySelector('#gallery').hidden
      && document.querySelector('#gallery .gcard'));
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
  }
});
