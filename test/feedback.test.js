import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_LIMIT, FEEDBACK_STATUSES, validateSubmission } from '../src/feedback.js';

const { app } = await import('../src/server.js');
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const USER_ID = '00000000-0000-4000-8000-000000000001';
const FEEDBACK_ID = '00000000-0000-4000-8000-000000000002';

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

test('feedback submissions validate category, message, page, and optional deck context', () => {
  const valid = validateSubmission({
    category: 'suggestion',
    message: '  Please add a duplicate-slide action.  ',
    context_page: '/studio/deck/abc',
    deck_id: USER_ID,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.value.message, 'Please add a duplicate-slide action.');

  for (const input of [
    { category: 'admin', message: 'Hello' },
    { category: 'bug', message: ' '.repeat(4) },
    { category: 'other', message: 'x'.repeat(FEEDBACK_MESSAGE_LIMIT + 1) },
    { category: 'question', message: 'Hello', context_page: '//external.test' },
    { category: 'question', message: 'Hello', context_page: '/bad\\path' },
    { category: 'question', message: 'Hello', deck_id: 'not-a-uuid' },
  ]) {
    assert.equal(validateSubmission(input).valid, false, JSON.stringify(input));
  }
  assert.deepEqual(FEEDBACK_CATEGORIES, ['suggestion', 'bug', 'question', 'other']);
  assert.deepEqual(FEEDBACK_STATUSES, ['new', 'reviewing', 'planned', 'resolved', 'declined']);
});

test('dashboard feedback submits contextual messages and admins can review safely and update status', async () => {
  const page = await browser.newPage();
  const pageErrors = [];
  let submitted;
  let updated;
  const requests = [];
  const unsafeMessage = '<img src=x onerror="window.__injected=true"> Please fix the save button.';
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
      if (url.origin === base) requests.push(`${request.method()} ${url.pathname}`);
      if (url.hostname === 'esm.sh') {
        await respond(`export function createClient() {
          const session = { user: { id: '${USER_ID}', email: 'admin@example.test' }, access_token: 'feedback-test-token' };
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
        await respond({ ok: true, isAdmin: true, styles: [] });
      } else if (url.pathname === '/api/admin/templates') {
        await respond({ ok: true, templates: [] });
      } else if (url.pathname === '/api/feedback' && request.method() === 'POST') {
        submitted = JSON.parse(request.postData());
        await respond({ ok: true, feedback: { id: FEEDBACK_ID, created_at: new Date().toISOString() } });
      } else if (url.pathname === '/api/admin/feedback' && request.method() === 'GET') {
        await respond({
          ok: true,
          feedback: [{
            id: FEEDBACK_ID,
            user_id: USER_ID,
            user_email: 'member@example.test',
            category: 'bug',
            message: unsafeMessage,
            context_page: '/studio',
            deck_id: null,
            status: 'new',
            created_at: '2026-10-04T20:00:00.000Z',
          }],
        });
      } else if (url.pathname === `/api/admin/feedback/${FEEDBACK_ID}` && request.method() === 'PATCH') {
        updated = JSON.parse(request.postData());
        await respond({
          ok: true,
          feedback: {
            id: FEEDBACK_ID,
            user_id: USER_ID,
            user_email: 'member@example.test',
            category: 'bug',
            message: unsafeMessage,
            context_page: '/studio',
            deck_id: null,
            status: updated.status,
            created_at: '2026-10-04T20:00:00.000Z',
          },
        });
      } else {
        await request.continue();
      }
    };
    handle().catch((error) => request.abort().catch(() => { throw error; }));
  });

  try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'dashboard');
    await page.setViewport({ width: 390, height: 844 });
    const floatingButton = await page.$eval('#feedbackOpenBtn', (button) => {
      const style = getComputedStyle(button);
      const bounds = button.getBoundingClientRect();
      return {
        position: style.position,
        left: bounds.left,
        right: bounds.right,
        bottom: window.innerHeight - bounds.bottom,
        label: button.innerText.trim(),
      };
    });
    assert.equal(floatingButton.position, 'fixed');
    assert.ok(floatingButton.left >= 0 && floatingButton.right <= 390);
    assert.ok(floatingButton.bottom >= 0 && floatingButton.bottom < 30);
    assert.equal(floatingButton.label, 'Send feedback');
    await page.click('#feedbackOpenBtn');
    const dialogBounds = await page.$eval('#feedbackDialog', (dialog) => {
      const { left, right } = dialog.getBoundingClientRect();
      return { left, right, height: dialog.getBoundingClientRect().height };
    });
    assert.ok(dialogBounds.left >= 0 && dialogBounds.right <= 390);
    assert.ok(dialogBounds.height <= 844);
    await page.select('#feedbackCategory', 'suggestion');
    await page.type('#feedbackMessage', 'Please add keyboard shortcuts.');
    assert.equal(await page.$eval('#feedbackCounter', (node) => node.textContent), '30 / 4000');
    await page.click('#feedbackSubmitBtn');
    await page.waitForFunction(() => document.querySelector('#feedbackResult')?.textContent
      === 'Thank you — your feedback was sent.');
    assert.deepEqual(submitted, {
      category: 'suggestion',
      message: 'Please add keyboard shortcuts.',
      context_page: '/studio',
      deck_id: null,
    });

    await page.click('#feedbackCloseBtn');
    await page.click('#adminLink');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'admin'
      && location.pathname === '/studio/admin/templates');
    await page.click('.admin-nav [data-admin-page="feedback"]');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'admin'
      && location.pathname === '/studio/admin/feedback'
      && document.querySelector('.feedback-admin-card'), { timeout: 7000 }).catch(async (error) => {
      console.error('feedback admin load', await page.evaluate(() => ({
        view: document.documentElement.dataset.view,
        url: location.href,
        body: document.body.innerText.slice(0, 500),
      })), requests, pageErrors);
      throw error;
    });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.equal(await page.$eval('.feedback-admin-message', (node) => node.textContent), unsafeMessage);
    assert.equal(await page.$('img[onerror]'), null);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    await page.select('.feedback-admin-card select', 'reviewing');
    await page.waitForFunction(() => document.querySelector('.feedback-admin-card select')?.value === 'reviewing',
      { timeout: 5000 }).catch(async (error) => {
      console.error('feedback status update', updated, await page.$eval('#adminMessage', (node) => node.textContent),
        await page.$eval('.feedback-admin-card select', (node) => node.value), pageErrors);
      throw error;
    });
    assert.deepEqual(updated, { status: 'reviewing' });
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
  }
});
