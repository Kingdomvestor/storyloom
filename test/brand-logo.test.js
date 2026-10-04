import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { defaultDeck } from '../src/defaults.js';

const { app } = await import('../src/server.js');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let base;
let server;
let browser;

before(async () => {
  server = app.listen(0);
  await new Promise((resolveListening) => server.once('listening', resolveListening));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
});

after(async () => {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
});

test('brand logo upload is stored for its owner and renders inside the slide avatar circle', async () => {
  const page = await browser.newPage();
  const pageErrors = [];
  let savedLogoUrl = null;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    const source = message.location().url;
    if (message.type() === 'error' && !source.endsWith('/favicon.ico')) pageErrors.push(message.text());
  });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const respond = (body, status = 200, contentType = 'application/json') => request.respond({
      status,
      contentType,
      headers: contentType === 'application/javascript' ? { 'access-control-allow-origin': '*' } : {},
      body: contentType === 'application/javascript' || contentType.startsWith('image/')
        ? body
        : JSON.stringify(body),
    });
    const handle = async () => {
      const url = new URL(request.url());
      if (url.hostname === 'esm.sh') {
        await respond(`export function createClient() {
          const session = { user: { id: 'logo-user-id', email: 'logo@example.test' }, access_token: 'test-token' };
          return {
            auth: {
              getSession: async () => ({ data: { session } }),
              refreshSession: async () => ({ data: { session } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({})
            },
            storage: {
              from: () => ({
                upload: async (path, file, options) => {
                  const bitmap = await createImageBitmap(file);
                  window.__logoUpload = {
                    path,
                    type: file.type,
                    size: file.size,
                    width: bitmap.width,
                    height: bitmap.height,
                    upsert: options.upsert
                  };
                  bitmap.close();
                  return { data: { path }, error: null };
                },
                getPublicUrl: (path) => ({
                  data: { publicUrl: 'https://unit.test/storage/v1/object/public/brand-logos/' + path }
                })
              })
            }
          };
        }`, 200, 'application/javascript');
        return;
      }
      if (url.hostname === 'unit.test' && url.pathname.startsWith('/storage/v1/object/public/brand-logos/')) {
        await respond('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#c94c2e"/></svg>',
          200, 'image/svg+xml');
        return;
      }
      if (url.pathname === '/api/meta') {
        const meta = await (await fetch(`${base}/api/meta`)).json();
        meta.supabase = { url: 'https://unit.test', anonKey: 'test' };
        await respond(meta);
      } else if (url.pathname === '/api/decks' && request.method() === 'POST') {
        const payload = JSON.parse(request.postData());
        savedLogoUrl = payload.deck.brand.logo_url;
        await respond({ ok: true, id: 'logo-deck-id' });
      } else if (url.pathname === '/api/decks') {
        await respond({ ok: true, decks: [], credits: 5, plan: 'free', defaultBrand: null });
      } else if (url.pathname === '/api/styles') {
        await respond({ ok: true, isAdmin: false, styles: [] });
      } else if (url.pathname === '/api/brands') {
        await respond({ ok: true, brands: [] });
      } else if (url.pathname === '/api/validate') {
        await respond({ ok: true, errors: [], warnings: [] });
      } else {
        await request.continue();
      }
    };
    handle().catch((error) => request.abort().catch(() => { throw error; }));
  });

  try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'dashboard');
    const deck = defaultDeck('signature-african');
    await page.evaluate((starter) => window.__devSeed(starter), deck);
    await page.click('#panelTabs button[data-tab="brand"]');
    await page.waitForSelector('#b-logo');

    await page.$eval('#b-logo', async (input) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 900;
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#c94c2e');
      gradient.addColorStop(1, '#101a33');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, 'image/png'));
      window.__logoOriginalSize = blob.size;
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'brand.png', { type: 'image/png' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForFunction(() => {
      const image = document.querySelector('#preview')?.contentDocument?.querySelector('.avatar img');
      return window.__logoUpload && image?.complete && image.naturalWidth > 0
        && image.parentElement.classList.contains('has-logo')
        && document.querySelector('#preview')?.contentDocument.documentElement.dataset.ready === 'true';
    }, { timeout: 7000 });
    const upload = await page.evaluate(() => window.__logoUpload);
    assert.match(upload.path, /^logo-user-id\/[0-9a-f-]+\.webp$/i);
    assert.equal(upload.type, 'image/webp');
    assert.equal(upload.upsert, false);
    assert.ok(upload.size > 0 && upload.size < await page.evaluate(() => window.__logoOriginalSize));
    assert.ok(upload.width <= 512 && upload.height <= 512);
    assert.equal(await page.$eval('#preview', (frame) =>
      frame.contentDocument.querySelector('.avatar').getBoundingClientRect().width), 46);

    await page.click('#saveBtn');
    await page.waitForFunction(() => location.pathname === '/studio/deck/logo-deck-id');
    assert.match(savedLogoUrl,
      /^https:\/\/unit\.test\/storage\/v1\/object\/public\/brand-logos\/logo-user-id\//);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
  }
});

test('carousel template ignores non-HTTPS logo URLs and keeps the initial fallback', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(resolve('templates/carousel.html')).href, { waitUntil: 'domcontentloaded' });
    const deck = defaultDeck('signature-african');
    deck.brand = { name: 'Kingdomvestor', handle: 'Vestor', logo_url: 'javascript:alert(1)' };
    await page.evaluate((value) => {
      window.STORYLOOM.setDeck(value);
      window.STORYLOOM.renderSlide(0);
    }, deck);
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    assert.equal(await page.$('.avatar img'), null);
    assert.equal(await page.$eval('.avatar-initial', (node) => node.textContent), 'K');
  } finally {
    await page.close();
  }
});
