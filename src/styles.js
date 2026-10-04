/**
 * styles.js — a curated style library stored in Supabase, with admin-only writes.
 *
 * The renderer remains generic and reads a style record's `settings` object. The
 * database holds the approved visual configuration, not arbitrary CSS, which keeps
 * renders deterministic and preserves the exact same preview/export path.
 */
import { admin } from './supabase.js';
import { schema } from './validate.js';

const FIELDS = 'id, name, slug, description, status, settings, draft, is_system, created_by, created_at, updated_at';
const THEME_PROPERTIES = schema.properties.theme.properties;
const STYLE_THEME_PROPERTIES = Object.fromEntries(
  Object.entries(THEME_PROPERTIES).filter(([field]) => field !== 'layout'),
);
const STYLE_STATUSES = ['draft', 'published', 'archived'];
const COLOR_FIELDS = Object.entries(STYLE_THEME_PROPERTIES)
  .filter(([, property]) => Boolean(property.pattern))
  .map(([field]) => field);

export const STYLE_SETTINGS_CONTRACT = {
  baseStyleIds: [...THEME_PROPERTIES.base_style_id.enum],
  colorFields: COLOR_FIELDS,
  fields: Object.fromEntries(Object.entries(STYLE_THEME_PROPERTIES).map(([field, property]) => [
    field,
    {
      type: property.type,
      ...(property.maxLength === undefined ? {} : { maxLength: property.maxLength }),
      ...(property.minimum === undefined ? {} : { minimum: property.minimum }),
      ...(property.maximum === undefined ? {} : { maximum: property.maximum }),
      ...(property.enum === undefined ? {} : { enum: [...property.enum] }),
      ...(property.pattern === undefined ? {} : { pattern: property.pattern }),
    },
  ])),
  limits: {
    name: 60,
    slug: 40,
    description: 220,
    palette: THEME_PROPERTIES.palette.maxLength,
    fontPair: THEME_PROPERTIES.font_pair.maxLength,
  },
};

export function validateStyleInput(input = {}, { requireStatus = false } = {}) {
  const errors = [];
  const name = String(input.name ?? '').trim();
  if (!name || name.length > STYLE_SETTINGS_CONTRACT.limits.name) {
    errors.push(`Style name must be 1-${STYLE_SETTINGS_CONTRACT.limits.name} characters.`);
  }

  const rawSlug = String(input.slug ?? name).trim();
  const slug = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug || slug.length > STYLE_SETTINGS_CONTRACT.limits.slug) {
    errors.push(`Style slug must normalize to 1-${STYLE_SETTINGS_CONTRACT.limits.slug} letters, numbers, or hyphens.`);
  }

  const description = String(input.description ?? '').trim();
  if (description.length > STYLE_SETTINGS_CONTRACT.limits.description) {
    errors.push(`Style description must be at most ${STYLE_SETTINGS_CONTRACT.limits.description} characters.`);
  }

  if (requireStatus && !STYLE_STATUSES.includes(input.status)) {
    errors.push('Choose draft, published, or archived status.');
  } else if (input.status !== undefined && !STYLE_STATUSES.includes(input.status)) {
    errors.push('Choose draft, published, or archived status.');
  }

  const settings = input.settings ?? {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    errors.push('Style settings must be an object.');
  } else {
    errors.push(...validateStyleSettings(settings));
  }

  return { valid: errors.length === 0, errors };
}

export function validateStyleSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return ['Style settings must be an object.'];
  }

  const errors = [];
  for (const [field, value] of Object.entries(settings)) {
    const property = STYLE_THEME_PROPERTIES[field];
    if (!property) {
      errors.push(`Unsupported style setting: ${field}.`);
      continue;
    }
    if (property.enum && !property.enum.includes(value)) {
      errors.push(`Choose a supported value for ${field.replace(/_/g, ' ')}.`);
    } else if (property.type === 'string' && typeof value !== 'string') {
      errors.push(`${field.replace(/_/g, ' ')} must be text.`);
    } else if (property.maxLength !== undefined && value.length > property.maxLength) {
      errors.push(`${field.replace(/_/g, ' ')} must be at most ${property.maxLength} characters.`);
    } else if (property.pattern && !new RegExp(property.pattern).test(value)) {
      errors.push(`Enter a valid ${field.replace('_hex', '').replace(/_/g, ' ')} colour.`);
    } else if (property.type === 'integer'
      && (!Number.isInteger(value) || value < property.minimum || value > property.maximum)) {
      errors.push(`${field.replace(/_/g, ' ')} must be a whole number from ${property.minimum} to ${property.maximum}.`);
    }
  }
  return errors;
}

export function styleUpdateChanges(currentStatus, row, updatedAt) {
  const changes = { ...row, updated_at: updatedAt };
  if (currentStatus === 'published' && row.status === 'draft') {
    return { draft: row, updated_at: updatedAt };
  }
  if (row.status === 'published' || row.status === 'archived') changes.draft = null;
  return changes;
}

export function universalStyleSettings(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('Style settings must be an object.');
  }
  const universal = { ...settings };
  delete universal.layout;
  return universal;
}

function publicStyle(row) {
  return {
    ...row,
    is_system: Boolean(row.is_system),
    settings: universalStyleSettings(row.settings),
    ...(row.draft ? {
      draft: {
        ...row.draft,
        settings: universalStyleSettings(row.draft.settings),
      },
    } : {}),
  };
}

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
  for (const [field, property] of Object.entries(STYLE_THEME_PROPERTIES)) {
    const value = raw[field];
    if (value === undefined || value === null || value === '') continue;
    if (property.enum) {
      if (property.enum.includes(value)) settings[field] = value;
      continue;
    }
    if (property.type === 'integer') {
      const number = Number(value);
      if (Number.isInteger(number) && number >= property.minimum && number <= property.maximum) {
        settings[field] = number;
      }
      continue;
    }
    if (property.type !== 'string') continue;
    let text = String(value).trim().slice(0, property.maxLength ?? Infinity);
    if (COLOR_FIELDS.includes(field) && text && !text.startsWith('#')) text = `#${text}`;
    if (!text || (property.pattern && !new RegExp(property.pattern).test(text))) continue;
    settings[field] = text;
  }

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
    ...data.map((row) => publicStyle({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      is_system: Boolean(row.is_system),
      settings: row.settings ?? {},
    })),
  ];
}

export async function listAdmin() {
  const client = admin();
  if (!client) throw new Error('Styles are not configured on this server.');
  const { data, error } = await client.from('styles')
    .select(FIELDS)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`styles.listAdmin: ${error.message}`);
  return [
    ...DEFAULT_STYLES,
    ...(data ?? []).map(publicStyle),
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
  return publicStyle({
    id: data.id,
    name: data.name,
    slug: data.slug,
    status: data.status,
    is_system: Boolean(data.is_system),
    settings: data.settings ?? {},
  });
}

export async function create(userId, input) {
  const client = admin();
  if (!client) throw new Error('Styles are not configured on this server.');
  if (!(await isAdmin(userId))) throw new Error('Only admins can add styles.');

  const validation = validateStyleInput(input);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const row = normalise(input);
  const { data, error } = await client.from('styles')
    .insert({
      created_by: userId,
      ...row,
      settings: row.settings,
    })
    .select(FIELDS)
    .single();

  if (error) {
    const failure = new Error(`styles.create: ${error.message}`);
    failure.code = error.code;
    throw failure;
  }
  return data;
}

export async function update(id, input = {}, userId) {
  const client = admin();
  if (!client) throw new Error('Styles are not configured on this server.');
  if (!userId || !(await isAdmin(userId))) throw new Error('Only admins can update styles.');
  const validation = validateStyleInput(input, { requireStatus: true });
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const row = normalise(input);
  const { data: current, error: lookupError } = await client.from('styles')
    .select('status, is_system')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) throw new Error(`styles.update lookup: ${lookupError.message}`);
  if (!current || current.is_system) return null;

  const changes = styleUpdateChanges(current.status, { ...row, settings: row.settings }, new Date().toISOString());

  const { data, error } = await client.from('styles')
    .update(changes)
    .eq('id', id)
    .eq('is_system', false)
    .select(FIELDS)
    .maybeSingle();

  if (error) {
    const failure = new Error(`styles.update: ${error.message}`);
    failure.code = error.code;
    throw failure;
  }
  return data;
}
