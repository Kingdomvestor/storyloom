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

test('style picker renders template previews and wraps responsively', async () => {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1180, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base) {
        request.abort();
      } else {
        request.continue();
      }
    });
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#stylePicker .stylecard').length === 3);
    await page.waitForFunction(() => [...document.querySelectorAll('#stylePicker .style-preview')]
      .every((preview) => preview.dataset.state === 'ready'), { timeout: 15000 });
    const previewHeadings = await page.$$eval('#stylePicker .style-preview iframe', (frames) =>
      frames.map((frame) => frame.contentDocument.querySelector('.heading')?.textContent.trim()));
    assert.deepEqual(previewHeadings, [
      '5 rules for posts that actually travel',
      'The draft nobody wanted to write',
      'Ship a side project in one weekend',
    ]);
    await page.evaluate(() => {
      document.querySelector('#composer').hidden = false;
      const card = document.querySelector('#stylePicker .stylecard').cloneNode(true);
      card.querySelector('.nm').textContent = 'Custom style';
      document.querySelector('#stylePicker').appendChild(card);
    });

    const desktop = await page.$$eval('#stylePicker .stylecard', (cards) => cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, width: bounds.width };
    }));
    assert.equal(new Set(desktop.map((card) => card.top)).size, 1);
    assert.ok(desktop.every((card) => card.width >= 120), JSON.stringify(desktop));

    await page.setViewport({ width: 390, height: 844 });
    const mobile = await page.$$eval('#stylePicker .stylecard', (cards) => cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, right: bounds.right };
    }));
    assert.ok(mobile[0].top === mobile[1].top);
    assert.ok(mobile[2].top === mobile[3].top && mobile[2].top > mobile[0].top);
    assert.ok(mobile.every((card) => card.left >= 0 && card.right <= 390));
  } finally {
    await page.close();
  }
});
