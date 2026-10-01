/**
 * styles.js — a curated style library stored in Supabase, with admin-only writes.
 *
 * The renderer remains generic and reads a style record's `settings` object. The
 * database holds the approved visual configuration, not arbitrary CSS, which keeps
 * renders deterministic and preserves the exact same preview/export path.
 */
import { admin } from './supabase.js';

const FIELDS = 'id, name, slug, description, status, settings, is_system, created_by, created_at, updated_at';

export const DEFAULT_STYLES = [
  { id: 'signature-african', name: 'Signature African', status: 'published', is_system: true, settings: {} },
  { id: 'editorial-clean', name: 'Editorial Clean', status: 'published', is_system: true, settings: {} },
  { id: 'mono-terminal', name: 'Mono Terminal', status: 'published', is_system: true, settings: {} },
];

export function normalise(input = {}) {
  const raw = input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
    ? input.settings
    : {};

  const settings = {};
  const palette = String(raw.palette ?? '').trim().slice(0, 40);
  if (palette) settings.palette = palette;

  const colorFields = ['accent_hex', 'background_hex', 'surface_hex', 'foreground_hex'];
  for (const field of colorFields) {
    const value = String(raw[field] ?? '').trim();
    if (!value) continue;
    const cleaned = value.startsWith('#') ? value : `#${value}`;
    if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) settings[field] = cleaned;
  }

  const fontPair = String(raw.font_pair ?? '').trim().slice(0, 120);
  if (fontPair) settings.font_pair = fontPair;

  const name = String(input.name ?? '').trim().slice(0, 60);
  const slugBase = String((input.slug ?? name) || 'custom-style').trim();
  const slug = slugBase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'custom-style';

  return {
    name: name || 'Custom style',
    slug,
    description: String(input.description ?? '').trim().slice(0, 220),
    status: ['draft', 'published', 'archived'].includes(input.status) ? input.status : 'draft',
    settings,
    is_system: false,
  };
}

export async function isAdmin(userId) {
  if (!userId || !admin()) return false;
  const { data, error } = await admin().from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  if (error && error.code !== '42P01' && error.code !== 'PGRST205' && error.code !== '42703') {
    throw new Error(`styles.isAdmin: ${error.message}`);
  }
  return Boolean(data?.is_admin);
}

export async function listPublished() {
  const client = admin();
  if (!client) return DEFAULT_STYLES;

  const { data, error } = await client.from('styles')
    .select(FIELDS)
    .eq('status', 'published')
    .order('updated_at', { ascending: false });

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    throw new Error(`styles.listPublished: ${error.message}`);
  }
  if (error || !data) return DEFAULT_STYLES;

  return [
    ...DEFAULT_STYLES,
    ...data.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      is_system: Boolean(row.is_system),
      settings: row.settings ?? {},
    })),
  ];
}

export async function getPublishedBySlug(slug) {
  const builtin = DEFAULT_STYLES.find((style) => style.id === slug);
  if (builtin) return builtin;

  const client = admin();
  if (!client) return null;
  const { data, error } = await client.from('styles')
    .select(FIELDS)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    throw new Error(`styles.getPublishedBySlug: ${error.message}`);
  }
  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    status: data.status,
    is_system: Boolean(data.is_system),
    settings: data.settings ?? {},
  };
}

export async function create(userId, input) {
  const client = admin();
  if (!client) throw new Error('Styles are not configured on this server.');
  if (!(await isAdmin(userId))) throw new Error('Only admins can add styles.');

  const row = normalise(input);
  const { data, error } = await client.from('styles')
    .insert({
      created_by: userId,
      ...row,
      settings: row.settings,
    })
    .select(FIELDS)
    .single();

  if (error) throw new Error(`styles.create: ${error.message}`);
  return data;
}
