/**
 * brands.js — the reusable footer identity, always scoped by user_id. Same rule
 * as decks.js: every query filters on the verified user id as well as relying on
 * RLS, so a brand that isn't yours is indistinguishable from one that doesn't
 * exist.
 *
 * The deck still carries a resolved `brand` object — the schema says so and the
 * template reads it. This table is only where that object is authored once and
 * copied from, which is the whole difference between per-deck fields and an
 * identity that survives into the next deck.
 */
import { admin } from './supabase.js';
import { schema } from './validate.js';

const FIELDS = 'id, name, handle, logo_url, is_default, updated_at';

// Caps come off the schema, so a brand applied to a deck can never be the reason
// that deck stops validating.
const CAPS = schema.properties.brand.properties;

/** Trim and cap a submitted brand. Returns exactly the columns we store. */
export function normalise(input = {}) {
  const text = (v, cap) => String(v ?? '').trim().slice(0, cap);
  return {
    name: text(input.name, CAPS.name.maxLength),
    handle: text(input.handle, CAPS.handle.maxLength),
    logo_url: input.logo_url ? text(input.logo_url, CAPS.logo_url.maxLength) : null,
  };
}

/** Strip the storage columns back to the shape the deck's `brand` field takes. */
export function toDeckBrand(row) {
  if (!row) return undefined;
  const brand = {};
  if (row.name) brand.name = row.name;
  if (row.handle) brand.handle = row.handle;
  if (row.logo_url) brand.logo_url = row.logo_url;
  return Object.keys(brand).length ? brand : undefined;
}

export async function list(userId) {
  const { data, error } = await admin().from('brands')
    .select(FIELDS)
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  // Missing relations may surface as a Postgres or PostgREST schema-cache code.
  if (error?.code === '42P01' || error?.code === 'PGRST205') {
    throw new Error('brands table is missing — run supabase/migrations/0002_brands_plan.sql');
  }
  if (error) throw new Error(`brands.list: ${error.message}`);
  return data;
}

export async function getDefault(userId) {
  const { data, error } = await admin().from('brands')
    .select(FIELDS)
    .eq('user_id', userId).eq('is_default', true).maybeSingle();
  // Tolerant on purpose: this one is read on the way into the editor, so a
  // database still on migration 0001 should mean "no default brand", not a
  // failure to open a deck.
  if (error?.code === '42P01' || error?.code === 'PGRST205') return null;
  if (error) throw new Error(`brands.getDefault: ${error.message}`);
  return data;
}

/**
 * Clear the current default. Runs *before* setting a new one, because
 * brands_one_default_per_user is a unique index — two defaults is a rejected
 * write, not a silently wrong row.
 */
async function clearDefault(userId) {
  const { error } = await admin().from('brands')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('is_default', true);
  if (error) throw new Error(`brands.clearDefault: ${error.message}`);
}

export async function create(userId, input) {
  const row = normalise(input);
  const wantsDefault = Boolean(input.is_default);
  if (wantsDefault) await clearDefault(userId);
  const { data, error } = await admin().from('brands')
    .insert({ user_id: userId, ...row, is_default: wantsDefault })
    .select(FIELDS).single();
  if (error) throw new Error(`brands.create: ${error.message}`);
  return data;
}

export async function update(userId, id, input) {
  const row = normalise(input);
  if (input.is_default) await clearDefault(userId);
  const patch = { ...row, updated_at: new Date().toISOString() };
  if (input.is_default !== undefined) patch.is_default = Boolean(input.is_default);
  const { data, error } = await admin().from('brands')
    .update(patch)
    .eq('user_id', userId).eq('id', id)
    .select(FIELDS).maybeSingle();
  if (error) throw new Error(`brands.update: ${error.message}`);
  return data; // null when not theirs
}

export async function remove(userId, id) {
  const { error, count } = await admin().from('brands')
    .delete({ count: 'exact' })
    .eq('user_id', userId).eq('id', id);
  if (error) throw new Error(`brands.remove: ${error.message}`);
  return (count ?? 0) > 0;
}
