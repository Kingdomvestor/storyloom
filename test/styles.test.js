import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise } from '../src/styles.js';
import { validateDeck } from '../src/validate.js';

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