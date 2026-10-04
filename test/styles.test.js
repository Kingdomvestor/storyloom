import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise,
  STYLE_SETTINGS_CONTRACT,
  styleUpdateChanges,
  universalStyleSettings,
  validateStyleInput,
} from '../src/styles.js';
import { repairDeck, schema, validateDeck } from '../src/validate.js';

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

test('custom styles preserve supported settings but not template layout', () => {
  const style = normalise({
    name: 'Centered Editorial',
    settings: {
      base_style_id: 'editorial-clean',
      layout: 'centered',
      heading_font_size: 88,
      body_font_size: 30,
    },
  });
  assert.equal(style.settings.base_style_id, 'editorial-clean');
  assert.equal(style.settings.layout, undefined);
  assert.equal(style.settings.heading_font_size, 88);
  assert.equal(style.settings.body_font_size, 30);

  const invalid = normalise({
    name: 'Invalid look',
    settings: { base_style_id: 'custom-style', layout: 'floating' },
  });
  assert.equal(invalid.settings.base_style_id, undefined);
  assert.equal(invalid.settings.layout, undefined);
});

test('style authoring contract is derived from the carousel theme schema', () => {
  const theme = schema.properties.theme.properties;
  assert.deepEqual(STYLE_SETTINGS_CONTRACT.baseStyleIds, theme.base_style_id.enum);
  assert.equal(STYLE_SETTINGS_CONTRACT.fields.layout, undefined);
  assert.deepEqual(STYLE_SETTINGS_CONTRACT.colorFields, Object.entries(theme)
    .filter(([field, property]) => field !== 'layout' && Boolean(property.pattern))
    .map(([field]) => field));
  for (const [field, property] of Object.entries(theme).filter(([field]) => field !== 'layout')) {
    assert.equal(STYLE_SETTINGS_CONTRACT.fields[field].type, property.type);
    assert.deepEqual(STYLE_SETTINGS_CONTRACT.fields[field].enum, property.enum);
    assert.equal(STYLE_SETTINGS_CONTRACT.fields[field].maxLength, property.maxLength);
    assert.equal(STYLE_SETTINGS_CONTRACT.fields[field].minimum, property.minimum);
    assert.equal(STYLE_SETTINGS_CONTRACT.fields[field].maximum, property.maximum);
  }
  assert.equal(STYLE_SETTINGS_CONTRACT.limits.fontPair, theme.font_pair.maxLength);
  assert.equal(STYLE_SETTINGS_CONTRACT.limits.palette, theme.palette.maxLength);

  assert.equal(validateStyleInput({
    name: 'Soft green',
    slug: 'soft-green',
    status: 'draft',
    settings: {
      base_style_id: 'editorial-clean',
      heading_font_pair: '"Playfair Display", Georgia, serif',
      heading_font_size: 104,
      body_font_size: 34,
      font_pair: '"Open Sans", system-ui, sans-serif',
      accent_hex: '#12ab34',
    },
  }).valid, true);
  assert.deepEqual(validateStyleInput({
    name: 'Invalid style',
    slug: 'invalid-style',
    status: 'draft',
    settings: {
      layout: 'centered',
      background_hex: 'red',
      heading_font_size: 500,
      arbitrary_css: 'body { display: none }',
    },
  }).errors, [
    'Unsupported style setting: layout.',
    'Enter a valid background colour.',
    'heading font size must be a whole number from 34 to 132.',
    'Unsupported style setting: arbitrary_css.',
  ]);
});

test('universal styles preserve typography and palette but never override template layout', () => {
  assert.deepEqual(universalStyleSettings({
    layout: 'centered',
    heading_font_pair: '"Playfair Display", Georgia, serif',
    heading_font_size: 88,
    accent_hex: '#12ab34',
  }), {
    heading_font_pair: '"Playfair Display", Georgia, serif',
    heading_font_size: 88,
    accent_hex: '#12ab34',
  });
  assert.throws(() => universalStyleSettings([]), /Style settings must be an object/);
});

test('published style edits remain draft snapshots until published', () => {
  const draft = {
    name: 'New name',
    slug: 'new-name',
    status: 'draft',
    settings: { layout: 'centered' },
  };
  const held = styleUpdateChanges('published', draft, '2026-10-04T00:00:00.000Z');
  assert.deepEqual(held, { draft, updated_at: '2026-10-04T00:00:00.000Z' });

  const published = styleUpdateChanges('published', { ...draft, status: 'published' }, 'now');
  assert.equal(published.name, 'New name');
  assert.equal(published.draft, null);

  const archived = styleUpdateChanges('published', { ...draft, status: 'archived' }, 'now');
  assert.equal(archived.status, 'archived');
  assert.equal(archived.draft, null);
});

test('template composition is independent from style settings and repair drops unsupported values', () => {
  const deck = {
    format: 'carousel',
    platform: 'linkedin',
    aspect_ratio: '4:5',
    style_id: 'editorial-clean',
    narrative_type: 'story',
    source: 'template',
    title: 'Layout check',
    layout: 'left-rail',
    theme: { base_style_id: 'editorial-clean', heading_font_size: 104 },
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
    layout: 'floating',
    theme: { base_style_id: 'unknown-style', layout: 'floating' },
  });
  assert.deepEqual(repaired.theme, {});
  assert.equal(repaired.layout, undefined);
  assert.equal(validateDeck(repaired).valid, true);
});