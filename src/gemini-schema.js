/**
 * Derive a Gemini-safe response schema from the strict JSON Schema.
 *
 * Why derive instead of hand-maintaining a second copy: the character caps in
 * schemas/carousel.schema.json are the same numbers the template's autofit was
 * tuned against. A hand-written duplicate drifts the first time a cap changes,
 * and the failure is silent — the model writes a 90-char heading, Ajv rejects
 * it, and the retry burns a call for no reason.
 *
 * Probed against gemini-3.7-flash on 2026-09-02:
 *   accepted  → type, enum, minLength, maxLength, pattern, minItems, maxItems,
 *               properties, required, items, description, format, nullable
 *   HARD 400  → additionalProperties, $ref, $defs, const
 *
 * The 400s are unrecoverable (Invalid JSON payload / "Cannot find field"), so
 * this whitelists known-good keys rather than blacklisting known-bad ones —
 * a future schema addition degrades to "ignored", never to "request rejected".
 */

/** Keys Gemini's OpenAPI-subset parser accepts. Anything else is dropped. */
const ALLOWED = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'propertyOrdering',
]);

/** Resolve an internal $ref like "#/$defs/slide" against the root schema. */
function deref(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`toGeminiSchema: only local $refs are supported, got "${ref}"`);
  }
  let node = root;
  for (const seg of ref.slice(2).split('/')) {
    node = node?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`toGeminiSchema: unresolvable $ref "${ref}"`);
  }
  return node;
}

function typeOfValue(v) {
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return undefined;
}

function convert(node, root, seen) {
  if (node === null || typeof node !== 'object') return node;

  if (node.$ref) {
    // Guard against a self-referential schema: we inline, so a cycle is infinite.
    if (seen.has(node.$ref)) throw new Error(`toGeminiSchema: cyclic $ref "${node.$ref}"`);
    return convert(deref(node.$ref, root), root, new Set(seen).add(node.$ref));
  }

  const out = {};

  // const → single-value enum. Gemini has no `const`, but a one-item enum is
  // exactly as constraining and keeps the value visible to the model.
  if ('const' in node) {
    out.enum = [node.const];
    out.type = node.type ?? typeOfValue(node.const) ?? 'string';
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'const') continue;
    if (!ALLOWED.has(key)) continue; // $schema, $id, title, default, additionalProperties …

    if (key === 'properties') {
      const props = {};
      for (const [name, sub] of Object.entries(value)) props[name] = convert(sub, root, seen);
      out.properties = props;
      continue;
    }
    if (key === 'items') {
      out.items = convert(value, root, seen);
      continue;
    }
    out[key] = value;
  }

  // Gemini wants a type alongside enum, and infers nothing.
  if (out.enum && !out.type) out.type = typeOfValue(out.enum[0]) ?? 'string';

  if (out.properties) {
    out.type ??= 'object';
    // propertyOrdering is Gemini-specific: it fixes generation order, which
    // measurably improves coherence (heading written before the body under it).
    out.propertyOrdering = Object.keys(out.properties);
    if (Array.isArray(out.required)) {
      const kept = out.required.filter((r) => r in out.properties);
      if (kept.length) out.required = kept;
      else delete out.required;
    }
  }
  if (out.items) out.type ??= 'array';

  return out;
}

/**
 * Delete a nested field from an already-converted schema.
 * Path segments are property names, except the literal "items" which steps into
 * an array's item schema — so "slides.items.image" reaches the slide's image.
 */
function prune(node, path) {
  const segs = path.split('.');
  const last = segs.pop();
  let cur = node;
  for (const seg of segs) {
    cur = seg === 'items' ? cur?.items : cur?.properties?.[seg];
    if (!cur) return; // path doesn't exist — nothing to remove
  }
  const target = last === 'items' ? cur : cur?.properties;
  if (!target) return;
  if (last === 'items') delete cur.items;
  else {
    delete target[last];
    if (Array.isArray(cur.required)) cur.required = cur.required.filter((r) => r !== last);
    if (Array.isArray(cur.propertyOrdering)) {
      cur.propertyOrdering = cur.propertyOrdering.filter((p) => p !== last);
    }
  }
}

/**
 * @param {object} schema  the strict draft-2020-12 schema
 * @param {object} [opts]
 * @param {string[]} [opts.pick]  top-level properties to keep. Everything else
 *   is stripped — the model should only author what it's actually responsible
 *   for. `brand` is injected from the brands table, `style_id`/`platform` come
 *   from the user's picker; asking Gemini for them spends tokens to invent a
 *   value we then overwrite, and gives it one more field to get wrong.
 * @param {string[]} [opts.omit]  dotted paths to drop after conversion, e.g.
 *   "slides.items.image". Use for fields the model must never touch.
 */
export function toGeminiSchema(schema, { pick, omit = [] } = {}) {
  const source = pick
    ? {
        ...schema,
        properties: Object.fromEntries(
          Object.entries(schema.properties).filter(([k]) => pick.includes(k))
        ),
        required: (schema.required ?? []).filter((k) => pick.includes(k)),
      }
    : schema;
  const out = convert(source, schema, new Set());
  for (const path of omit) prune(out, path);
  return out;
}
