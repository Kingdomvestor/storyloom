import { admin } from './supabase.js';
import { isAdmin } from './styles.js';

const FIELDS = 'id, name, slug, description, status, deck, created_by, created_at';

export function normalise(input = {}) {
  const name = String(input.name ?? '').trim().slice(0, 60);
  const slug = (String(input.slug ?? '').trim() || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const description = String(input.description ?? '').trim().slice(0, 220);

  return { name, slug, description, deck: input.deck };
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
      status: 'published',
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
