import { admin } from './supabase.js';
import { isAdmin } from './styles.js';

const FIELDS = 'id, name, slug, description, status, deck, draft, created_by, created_at, updated_at';

export function normalise(input = {}) {
  const name = String(input.name ?? '').trim().slice(0, 60);
  const slug = (String(input.slug ?? '').trim() || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const description = String(input.description ?? '').trim().slice(0, 220);

  return {
    name,
    slug,
    description,
    status: ['draft', 'published', 'archived'].includes(input.status) ? input.status : 'published',
    deck: input.deck,
  };
}

export async function listPublished() {
  const client = admin();
  if (!client) return [];

  const { data, error } = await client.from('starter_templates')
    .select(FIELDS)
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    throw new Error(`starterTemplates.listPublished: ${error.message}`);
  }
  return error ? [] : data ?? [];
}

export async function listAdmin() {
  const client = admin();
  if (!client) throw new Error('Templates are not configured on this server.');
  const { data, error } = await client.from('starter_templates')
    .select(FIELDS)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`starterTemplates.listAdmin: ${error.message}`);
  return data ?? [];
}

export async function create(userId, input = {}) {
  const client = admin();
  if (!client) throw new Error('Templates are not configured on this server.');
  if (!(await isAdmin(userId))) throw new Error('Only admins can publish templates.');

  const row = normalise(input);
  if (!row.name || !row.slug || !row.deck || typeof row.deck !== 'object' || Array.isArray(row.deck)) {
    throw new Error('A template needs a name, slug, and valid deck.');
  }

  const { data, error } = await client.from('starter_templates')
    .insert({
      created_by: userId,
      ...row,
      status: row.status,
    })
    .select(FIELDS)
    .single();

  if (error) {
    const failure = new Error(`starterTemplates.create: ${error.message}`);
    failure.code = error.code;
    throw failure;
  }
  return data;
}

export async function update(id, input = {}) {
  const client = admin();
  if (!client) throw new Error('Templates are not configured on this server.');
  const row = normalise(input);
  if (!row.name || !row.slug || !row.deck || typeof row.deck !== 'object' || Array.isArray(row.deck)) {
    throw new Error('A template needs a name, slug, and valid deck.');
  }

  const { data: current, error: lookupError } = await client.from('starter_templates')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) throw new Error(`starterTemplates.update lookup: ${lookupError.message}`);
  if (!current) return null;

  let changes = { ...row, updated_at: new Date().toISOString() };
  if (current.status === 'published' && row.status === 'draft') {
    changes = { draft: row, updated_at: changes.updated_at };
  } else if (row.status === 'published' || row.status === 'archived') {
    changes.draft = null;
  }

  const { data, error } = await client.from('starter_templates')
    .update(changes)
    .eq('id', id)
    .select(FIELDS)
    .maybeSingle();

  if (error) {
    const failure = new Error(`starterTemplates.update: ${error.message}`);
    failure.code = error.code;
    throw failure;
  }
  return data;
}
