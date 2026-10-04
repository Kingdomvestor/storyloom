import { admin } from './supabase.js';
import { isAdmin } from './styles.js';
import { validateDeck } from './validate.js';

const FIELDS = 'id, family_id, version, is_current, published_at, name, slug, description, status, deck, draft, created_by, created_at, updated_at';

export function templateUpdateChanges(current, row, updatedAt) {
  const changes = { ...row, updated_at: updatedAt };
  if ((current.status === 'draft' || current.status === 'archived')
    && row.status === 'published' && !current.published_at) {
    return { ...changes, published_at: updatedAt, draft: null };
  }
  if (current.status === 'published' && row.status === 'draft') {
    return { draft: row, updated_at: updatedAt };
  }
  if (current.status === 'published' && row.status === 'archived') {
    return { status: 'archived', draft: null, updated_at: updatedAt };
  }
  if (current.status === 'archived') {
    return { draft: row, updated_at: updatedAt };
  }
  if (row.status === 'published' || row.status === 'archived') changes.draft = null;
  return changes;
}

export function startsNewTemplateVersion(current, row) {
  return current.is_current
    && row.status === 'published'
    && (current.status === 'published'
      || (current.status === 'archived' && Boolean(current.published_at)));
}

export function publishedTemplateDeck(row) {
  if (!row?.deck || typeof row.deck !== 'object' || Array.isArray(row.deck)) return null;
  const deck = { ...row.deck, title: row.name, source: 'template' };
  return validateDeck(deck).valid ? deck : null;
}

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
    .eq('is_current', true)
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
    .eq('is_current', true)
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
      published_at: row.status === 'published' ? new Date().toISOString() : null,
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

export async function update(id, input = {}, userId) {
  const client = admin();
  if (!client) throw new Error('Templates are not configured on this server.');
  if (!userId || !(await isAdmin(userId))) throw new Error('Only admins can update templates.');
  const row = normalise(input);
  if (!row.name || !row.slug || !row.deck || typeof row.deck !== 'object' || Array.isArray(row.deck)) {
    throw new Error('A template needs a name, slug, and valid deck.');
  }

  const { data: current, error: lookupError } = await client.from('starter_templates')
    .select('status, family_id, version, is_current, published_at')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) throw new Error(`starterTemplates.update lookup: ${lookupError.message}`);
  if (!current) return null;
  if (!current.is_current) {
    throw new Error('Published template versions are immutable.');
  }

  if (startsNewTemplateVersion(current, row)) {
    const { data, error } = await client.rpc('publish_starter_template_version', {
      p_id: id,
      p_name: row.name,
      p_slug: row.slug,
      p_description: row.description,
      p_deck: row.deck,
      p_created_by: userId,
    });
    if (error) {
      const failure = new Error(`starterTemplates.publishVersion: ${error.message}`);
      failure.code = error.code;
      throw failure;
    }
    return data;
  }

  const changes = templateUpdateChanges(current, row, new Date().toISOString());

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
