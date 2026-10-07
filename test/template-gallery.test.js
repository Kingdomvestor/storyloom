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
    (value) => value.replaceAll('-', ' ')
  );

  await loadGallery();
  assert.match(document.querySelector('[role="alert"]').textContent, /Sign in to continue/);
  assert.equal(document.querySelector('#gallery').hasAttribute('aria-busy'), false);

  await document.querySelector('#gallery button').onclick();
  assert.equal(document.querySelector('#gallery [role="status"]').textContent, 'No templates are available right now.');
  assert.equal(requestCount, 2);
});

test('template gallery filters by search, style, and format', async () => {
  const dom = new JSDOM('<section id="gallery"></section>');
  const { document } = dom.window;
  const decks = [
    { title: 'Rules for travel', style_id: 'signature-african', narrative_type: 'listicle', slides: [{}] },
    { title: 'The draft', style_id: 'editorial-clean', narrative_type: 'story', slides: [{}] },
    { title: 'Ship a project', style_id: 'mono-terminal', narrative_type: 'how-to', slides: [{}] },
  ];
  const api = async () => ({ ok: true, decks });
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
    (value) => value.replaceAll('-', ' ')
  );

  await loadGallery();
  const cards = [...document.querySelectorAll('.gcard')];
  const search = document.querySelector('[aria-label="Search templates"]');
  const style = document.querySelector('[aria-label="Filter templates by style"]');
  const format = document.querySelector('[aria-label="Filter templates by format"]');
  assert.equal(cards.length, 3);
  assert.match(document.querySelector('.gallery-summary').textContent, /3 of 3 templates/);

  search.value = 'draft';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(cards.map((card) => card.hidden), [true, false, true]);

  search.value = '';
  search.dispatchEvent(new dom.window.Event('input'));
  style.value = 'mono-terminal';
  style.dispatchEvent(new dom.window.Event('change'));
  format.value = 'how-to';
  format.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(cards.map((card) => card.hidden), [true, true, false]);

  style.value = '';
  format.value = '';
  search.value = 'editorial clean';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(cards.map((card) => card.hidden), [true, false, true]);

  format.value = 'how-to';
  format.dispatchEvent(new dom.window.Event('change'));
  assert.equal(document.querySelector('.gallery-notice').hidden, false);
  assert.match(document.querySelector('.gallery-summary').textContent, /0 of 3 templates/);
});
