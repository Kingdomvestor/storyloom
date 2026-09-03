/**
 * decks.js — deck rows, always scoped by user_id. Scoping every query by the
 * verified user id (not just RLS) is what makes "not yours" indistinguishable
 * from "does not exist": get/update/remove simply match nothing.
 */
import { admin } from './supabase.js';

export async function list(userId) {
  const { data, error } = await admin.from('decks')
    .select('id, title, source, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`decks.list: ${error.message}`);
  return data;
}

export async function get(userId, id) {
  const { data, error } = await admin.from('decks')
    .select('id, title, source, deck, updated_at')
    .eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) throw new Error(`decks.get: ${error.message}`);
  return data; // null when not found / not theirs
}

export async function create(userId, { title, source, deck }) {
  const { data, error } = await admin.from('decks')
    .insert({ user_id: userId, title, source, deck })
    .select('id').single();
  if (error) throw new Error(`decks.create: ${error.message}`);
  return data.id;
}

export async function update(userId, id, { title, source, deck }) {
  const { data, error } = await admin.from('decks')
    .update({ title, source, deck, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('id', id)
    .select('id').maybeSingle();
  if (error) throw new Error(`decks.update: ${error.message}`);
  return data; // null when not theirs
}

export async function remove(userId, id) {
  const { error, count } = await admin.from('decks')
    .delete({ count: 'exact' })
    .eq('user_id', userId).eq('id', id);
  if (error) throw new Error(`decks.remove: ${error.message}`);
  return (count ?? 0) > 0;
}
