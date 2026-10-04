import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const galleryScript = appJs.slice(
  appJs.indexOf('async function loadGallery() {'),
  appJs.indexOf('// ===================================================================== EDITOR')
);

test('template gallery reports load failures and can retry', async () => {
  const dom = new JSDOM('<section id="gallery"></section>');
  const { document } = dom.window;
  let requestCount = 0;
  const api = async () => {
    requestCount += 1;
    return requestCount === 1
      ? { ok: false, message: 'Sign in to continue.' }
      : { ok: true, decks: [] };
  };
  class ResizeObserver {
    observe() {}
  }
  const loadGallery = new Function(
    'document', '$', 'api', 'ResizeObserver', 'scaleFrame', 'show', '$$', 'label',
    `${galleryScript}; return loadGallery;`
  )(
    document,
    (selector, root = document) => root.querySelector(selector),
    api,
    ResizeObserver,
    () => {},
    async () => {},
    (selector, root = document) => [...root.querySelectorAll(selector)],
    (value) => value
  );

  await loadGallery();
  assert.match(document.querySelector('[role="alert"]').textContent, /Sign in to continue/);
  assert.equal(document.querySelector('#gallery').hasAttribute('aria-busy'), false);

  await document.querySelector('#gallery button').onclick();
  assert.equal(document.querySelector('#gallery [role="status"]').textContent, 'No templates are available right now.');
  assert.equal(requestCount, 2);
});
