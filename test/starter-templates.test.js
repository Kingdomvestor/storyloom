import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise } from '../src/starter-templates.js';

test('template slug defaults to a normalized name when omitted', () => {
  const row = normalise({ name: 'Warm Editorial', slug: '' });
  assert.equal(row.slug, 'warm-editorial');
});

test('template slug is normalized when provided', () => {
  const row = normalise({ name: 'Warm Editorial', slug: '  Spring 2026! ' });
  assert.equal(row.slug, 'spring-2026');
});
