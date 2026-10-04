import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise,
  publishedTemplateDeck,
  startsNewTemplateVersion,
  templateUpdateChanges,
} from '../src/starter-templates.js';
import { defaultDeck } from '../src/defaults.js';

test('template slug defaults to a normalized name when omitted', () => {
  const row = normalise({ name: 'Warm Editorial', slug: '' });
  assert.equal(row.slug, 'warm-editorial');
});

test('template slug is normalized when provided', () => {
  const row = normalise({ name: 'Warm Editorial', slug: '  Spring 2026! ' });
  assert.equal(row.slug, 'spring-2026');
});

test('published template projection overrides untrusted title and source and rejects invalid decks', () => {
  const deck = defaultDeck('signature-african');
  const published = publishedTemplateDeck({
    name: 'Reviewed starter',
    deck: { ...deck, title: 'Forged title', source: 'ai' },
  });
  assert.equal(published.title, 'Reviewed starter');
  assert.equal(published.source, 'template');
  assert.equal(publishedTemplateDeck({ name: 'Invalid', deck: { ...deck, slides: [] } }), null);
  assert.equal(publishedTemplateDeck({ name: 'Invalid', deck: [] }), null);
});

test('published template edits are held separately until explicit publish', () => {
  const current = {
    status: 'published',
    is_current: true,
    version: 1,
    family_id: 'family-1',
    published_at: '2026-10-01T00:00:00.000Z',
  };
  const draft = {
    name: 'Edited starter',
    slug: 'edited-starter',
    status: 'draft',
    deck: defaultDeck('editorial-clean'),
  };
  const held = templateUpdateChanges(current, draft, '2026-10-04T00:00:00.000Z');
  assert.deepEqual(held, { draft, updated_at: '2026-10-04T00:00:00.000Z' });

  const publishedRow = { ...draft, status: 'published' };
  assert.equal(startsNewTemplateVersion(current, publishedRow), true);

  const published = templateUpdateChanges({ status: 'draft', is_current: true }, publishedRow, 'now');
  assert.equal(published.name, 'Edited starter');
  assert.equal(published.draft, null);

  const archived = templateUpdateChanges(current, { ...draft, status: 'archived' }, 'now');
  assert.equal(archived.status, 'archived');
  assert.equal(archived.draft, null);
  assert.equal(startsNewTemplateVersion({ ...current, status: 'archived' }, publishedRow), true);
  assert.equal(startsNewTemplateVersion({ ...current, is_current: false }, publishedRow), false);
});

test('archived template edits stay drafts and restoring creates a successor', () => {
  const current = {
    status: 'archived',
    is_current: true,
    version: 2,
    family_id: 'family-1',
    published_at: '2026-10-03T00:00:00.000Z',
  };
  const draft = {
    name: 'Restored starter',
    slug: 'edited-starter',
    status: 'archived',
    deck: defaultDeck('mono-terminal'),
  };
  assert.deepEqual(
    templateUpdateChanges(current, draft, '2026-10-04T00:00:00.000Z'),
    { draft, updated_at: '2026-10-04T00:00:00.000Z' },
  );
  assert.equal(startsNewTemplateVersion(current, { ...draft, status: 'published' }), true);

  const unpublishedArchive = { ...current, published_at: null };
  assert.equal(startsNewTemplateVersion(unpublishedArchive, { ...draft, status: 'published' }), false);
  assert.equal(templateUpdateChanges(
    unpublishedArchive,
    { ...draft, status: 'published' },
    '2026-10-04T00:00:00.000Z',
  ).published_at, '2026-10-04T00:00:00.000Z');
});
