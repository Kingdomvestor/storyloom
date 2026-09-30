import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const choiceFlowScript = appJs.slice(
  appJs.indexOf('function showNewDeckChoice()'),
  appJs.indexOf('function wireCompose()')
);

function mountChoiceFlow() {
  const dom = new JSDOM(`
    <body>
      <section id="newDeckChoice" hidden></section>
      <section id="composer"></section>
      <section id="gallery"></section>
      <textarea id="sourceText"></textarea>
    </body>
  `, { url: 'https://storyloom.local/' });
  const { window } = dom;
  const doc = window.document;

  window.$ = (sel, root = doc) => root.querySelector(sel);
  window.$$ = (sel, root = doc) => [...root.querySelectorAll(sel)];

  window.loadGallery = () => {};
  const { showNewDeckChoice, beginNewDeckChoice } = new Function(
    'document',
    'window',
    '$',
    '$$',
    'loadGallery',
    `${choiceFlowScript}; return { showNewDeckChoice, beginNewDeckChoice };`
  )(doc, window, window.$, window.$$, window.loadGallery);

  window.showNewDeckChoice = showNewDeckChoice;
  window.beginNewDeckChoice = beginNewDeckChoice;
  return dom;
}

test('new carousel opens on a choice screen, then resolves to generate or template flows', () => {
  const dom = mountChoiceFlow();
  const { document, showNewDeckChoice, beginNewDeckChoice } = dom.window;

  const choice = document.getElementById('newDeckChoice');
  const composer = document.getElementById('composer');
  const gallery = document.getElementById('gallery');

  showNewDeckChoice();
  assert.equal(choice.hidden, false, 'the choice panel opens from the dashboard action');
  assert.equal(composer.hidden, true, 'composer is hidden while the user decides');
  assert.equal(gallery.hidden, true, 'templates stay hidden during the decision step');

  beginNewDeckChoice('generate');
  assert.equal(choice.hidden, true, 'choice panel closes when a mode is selected');
  assert.equal(composer.hidden, false, 'generate mode reveals the composer');

  beginNewDeckChoice('template');
  assert.equal(gallery.hidden, false, 'template mode reveals the gallery');
  assert.equal(composer.hidden, true, 'template path hides the generator form');
});
