import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise } from '../src/styles.js';
import { repairDeck, validateDeck } from '../src/validate.js';

test('font stacks longer than 40 characters survive normalization and deck validation', () => {
  const fontPair = '"Open Sans", "Avenir Next", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  assert.ok(fontPair.length > 40 && fontPair.length <= 120);

  const style = normalise({ name: 'Long font stack', settings: { font_pair: fontPair } });
  assert.equal(style.settings.font_pair, fontPair);

  const deck = {
    format: 'carousel',
    platform: 'linkedin',
    aspect_ratio: '4:5',
    style_id: 'editorial-clean',
    narrative_type: 'story',
    source: 'template',
    title: 'Font limit check',
    theme: { font_pair: fontPair },
    slides: [
      { type: 'hook', heading: 'Opening' },
      { type: 'body', heading: 'One' },
      { type: 'body', heading: 'Two' },
      { type: 'body', heading: 'Three' },
      { type: 'cta', heading: 'Closing' },
    ],
  };
  assert.equal(validateDeck(deck).valid, true);
});

test('custom styles preserve supported layout and built-in base style settings', () => {
  const style = normalise({
    name: 'Centered Editorial',
    settings: { base_style_id: 'editorial-clean', layout: 'centered' },
  });
  assert.equal(style.settings.base_style_id, 'editorial-clean');
  assert.equal(style.settings.layout, 'centered');

  const invalid = normalise({
    name: 'Invalid look',
    settings: { base_style_id: 'custom-style', layout: 'floating' },
  });
  assert.equal(invalid.settings.base_style_id, undefined);
  assert.equal(invalid.settings.layout, undefined);
});

test('deck schema accepts supported layout settings and repair drops unsupported values', () => {
  const deck = {
    format: 'carousel',
    platform: 'linkedin',
    aspect_ratio: '4:5',
    style_id: 'editorial-clean',
    narrative_type: 'story',
    source: 'template',
    title: 'Layout check',
    theme: { base_style_id: 'editorial-clean', layout: 'left-rail' },
    slides: [
      { type: 'hook', heading: 'Opening' },
      { type: 'body', heading: 'One' },
      { type: 'body', heading: 'Two' },
      { type: 'body', heading: 'Three' },
      { type: 'cta', heading: 'Closing' },
    ],
  };
  assert.equal(validateDeck(deck).valid, true);

  const repaired = repairDeck({
    ...deck,
    theme: { base_style_id: 'unknown-style', layout: 'floating' },
  });
  assert.deepEqual(repaired.theme, {});
  assert.equal(validateDeck(repaired).valid, true);
});