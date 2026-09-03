# Auth, Credits & Deck Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the existing compose → generate → edit → preview → render flow behind email/password accounts, enforce a free-credit budget on AI generation server-side, and persist each user's decks so "My decks" is real.

**Architecture:** `@supabase/supabase-js` runs in the browser for the auth lifecycle only (signup/login/refresh/logout). The SPA sends the access token as `Authorization: Bearer …`. Express is the sole authority on credits and decks via the secret service-role key, doing an atomic check-and-decrement co-located with the Gemini call and refunding on failure. Everything degrades gracefully when Supabase env is absent, mirroring the existing `hasApiKey` pattern, so the app boots for review before keys land.

**Tech Stack:** Node 24 (ESM), Express 5, `@supabase/supabase-js` v2 (server via npm, browser via esm.sh CDN), Supabase (hosted free tier: Auth + Postgres + RLS), Ajv 8 (existing validator, reused), Node 24 built-in `node:test`. No frontend build step.

**Spec:** `docs/superpowers/specs/2026-09-03-auth-credits-decks-design.md`

## Global Constraints

- `templates/carousel.html` stays **byte-for-byte untouched** — one template, two consumers (preview iframe + Puppeteer). Do not edit or duplicate it.
- `schemas/carousel.schema.json` stays the single source of truth. Deck save reuses the existing `validateDeck`; introduce **no second validator**.
- Every response is `{ ok: true, … }` or `{ ok: false, kind, message }`; `STATUS_BY_KIND` maps kind → HTTP status (`fail()` helper).
- One persistent Puppeteer browser via `queueRender()` — unchanged.
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY` is secret, server-only, bypasses RLS — never in the browser, a screenshot, or `.env.example`. `SUPABASE_URL` + `SUPABASE_ANON_KEY` are public-by-design. `.env.example` gets all three **empty-valued** (committable). `.env` is appended via heredoc, **never read into context**. Assume anything on screen is public.
- **Env on every Bash call:** `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"`. Use `process.env.TEMP`, never `/tmp`.
- Frontend: vanilla ES modules, no framework/bundler. Bootstrap + fonts already via CDN.
- Graceful degradation is a hard requirement: with no Supabase env, `hasSupabase === false`, `/api/meta` returns `supabase: null`, protected routes return `unauthorized`, and the SPA falls back to today's single-user compose-first behavior.

---

## File Structure

**Create:**
- `supabase/migrations/0001_auth_credits_decks.sql` — profiles + decks tables, `handle_new_user` trigger, `spend_credit`/`add_credit` functions, RLS policies. Run once by the user in the Supabase SQL editor.
- `src/supabase.js` — service-role admin client, `hasSupabase`, `publicConfig()`, `getUser(token)`.
- `src/credits.js` — `spend(userId)`, `refund(userId)`, `balance(userId)`.
- `src/decks.js` — `list`, `get`, `create`, `update`, `remove`, all scoped by `userId`.
- `test/supabase.test.js` — node:test: degradation exports (no env → `hasSupabase` false, `publicConfig()` null, `getUser()` null).
- `test/server-degraded.test.js` — node:test: import `app`, assert the no-Supabase contract end-to-end (meta shape, 401s, health).
- `scripts/verify-supabase.mjs` — post-keys end-to-end verification (auth → credits → refund → deck CRUD scoping). Run by the user after keys land.
- `docs/setup-supabase.md` — the ~10-min user checklist.

**Modify:**
- `package.json` — add `@supabase/supabase-js` dep + `test` script.
- `.env.example` — three empty Supabase keys.
- `src/server.js` — new `STATUS_BY_KIND` kinds; import modules; `requireUser`; extend `/api/meta`; protect routes; deck routes; credit flow in `/api/generate`.
- `public/index.html` — `#viewAuth`, `#viewDashboard` sections; header account controls; editor Save button.
- `public/app.css` — `.view-auth` / `.view-dashboard` rules + auth/dashboard/pill styles.
- `public/app.js` — supabase init, `api()` token + method + 401, session bootstrap, auth/dashboard wiring, save flow, credits, `openEditor` deckId.

---

## Task 0: Branch, dependency, test script, env template

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: `@supabase/supabase-js` importable in `src/`; `npm test` runs `node --test`; `.env.example` documents the three Supabase keys.

- [ ] **Step 1: Branch off master**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
cd "C:/Users/HP/Documents/Claude/Content-to-Visual Generator (Vestor)"
git checkout -b feat/auth-credits-decks
```

- [ ] **Step 2: Install the SDK**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
npm install @supabase/supabase-js
```

- [ ] **Step 3: Add the `test` script** to `package.json` scripts (after `"extract"`):

```json
    "extract": "node src/extract.js",
    "test": "node --test",
```

- [ ] **Step 4: Append three empty keys to `.env.example`** (read it first; keep values empty). Append:

```
# Supabase (hosted free-tier project). URL + ANON are public-by-design and go to
# the browser; SERVICE_ROLE is secret and server-only (bypasses RLS).
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 5: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add package.json package-lock.json .env.example
git commit -m "chore: add supabase-js, test script, env template for accounts"
```

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0001_auth_credits_decks.sql`

**Interfaces:**
- Produces: tables `public.profiles(id, credits, created_at)` and `public.decks(id, user_id, title, source, deck, created_at, updated_at)`; RPCs `spend_credit(uid uuid) → int` and `add_credit(uid uuid) → int`; a signup trigger granting 10 credits; owner-only RLS. Consumed by `src/credits.js` and `src/decks.js`.

*No unit test — this is DDL. It is applied by the user in the SQL editor and exercised by `scripts/verify-supabase.mjs` (Task 9).*

- [ ] **Step 1: Write the migration**

```sql
-- 0001_auth_credits_decks.sql — run once in the Supabase SQL editor.

-- profiles: 1:1 with auth.users, holds the credit balance.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  credits    int  not null default 10 check (credits >= 0),
  created_at timestamptz not null default now()
);

-- decks: one JSON deck per row, owned by a user.
create table if not exists public.decks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'Untitled',
  source     text not null default 'ai',       -- 'ai' | 'template'
  deck       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists decks_user_updated on public.decks (user_id, updated_at desc);

-- every new signup gets a profile row at 10 credits.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- atomic spend: one statement, no check-then-decrement race.
-- returns the new balance, or NULL (no row) when the user is out.
create or replace function public.spend_credit(uid uuid)
returns int language sql security definer as $$
  update public.profiles set credits = credits - 1
  where id = uid and credits > 0
  returning credits;
$$;

-- mirror, used to refund a failed generation.
create or replace function public.add_credit(uid uuid)
returns int language sql security definer as $$
  update public.profiles set credits = credits + 1
  where id = uid
  returning credits;
$$;

-- RLS: defense in depth. Express (service-role) is the real gate and bypasses
-- this, but if the anon key ever touched these tables directly, rows stay private.
alter table public.profiles enable row level security;
alter table public.decks    enable row level security;

create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "own decks" on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add supabase/migrations/0001_auth_credits_decks.sql
git commit -m "feat: db migration — profiles, decks, credit RPCs, RLS"
```

---

## Task 2: `src/supabase.js` — admin client + degradation

**Files:**
- Create: `src/supabase.js`
- Test: `test/supabase.test.js`

**Interfaces:**
- Produces:
  - `hasSupabase: boolean` — true only when all three env vars are present.
  - `admin` — service-role `SupabaseClient` or `null` when unconfigured.
  - `publicConfig(): { url, anonKey } | null` — browser-safe values or null.
  - `async getUser(token): { id, email } | null` — verifies a bearer token.
- Consumed by: `src/credits.js`, `src/decks.js`, `src/server.js`.

- [ ] **Step 1: Write the failing test** (`test/supabase.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ensure a clean, unconfigured environment BEFORE importing the module.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { hasSupabase, admin, publicConfig, getUser } = await import('../src/supabase.js');

test('degrades cleanly when unconfigured', async () => {
  assert.equal(hasSupabase, false);
  assert.equal(admin, null);
  assert.equal(publicConfig(), null);
  assert.equal(await getUser('any-token'), null);
  assert.equal(await getUser(''), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH" && node --test test/supabase.test.js`
Expected: FAIL — `Cannot find module '../src/supabase.js'`.

- [ ] **Step 3: Write the module** (`src/supabase.js`)

```js
/**
 * supabase.js — the server's line to Supabase.
 *
 * Two things are load-bearing here:
 *  1. The service-role client bypasses RLS, so it is server-only and never
 *     leaves this process. Only publicConfig() is safe to hand the browser.
 *  2. Absent env must not crash the app. hasSupabase gates everything,
 *     mirroring generate.js's hasApiKey — the app boots and /api/meta simply
 *     reports supabase:null.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasSupabase = Boolean(URL && ANON && SERVICE);

// Service-role: full access, RLS bypassed. No session persistence — this is a
// stateless server client that only ever acts on behalf of a verified user id.
export const admin = hasSupabase
  ? createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

/** Browser-safe config, or null when unconfigured. */
export function publicConfig() {
  return hasSupabase ? { url: URL, anonKey: ANON } : null;
}

/** Verify a user's access token. Returns { id, email } or null. */
export async function getUser(token) {
  if (!admin || !token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH" && node --test test/supabase.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add src/supabase.js test/supabase.test.js
git commit -m "feat: supabase admin client with graceful degradation"
```

---

## Task 3: `src/credits.js` — spend / refund / balance

**Files:**
- Create: `src/credits.js`

**Interfaces:**
- Consumes: `admin` from `src/supabase.js`; RPCs `spend_credit`, `add_credit`; table `profiles`.
- Produces:
  - `async spend(userId): number | null` — new balance, or `null` when out of credits.
  - `async refund(userId): number | null` — new balance after +1.
  - `async balance(userId): number` — current balance.
- Consumed by: `src/server.js` (`/api/generate`, deck list).

*Correctness needs a live DB — covered by `scripts/verify-supabase.mjs` (Task 9), not a unit test.*

- [ ] **Step 1: Write the module** (`src/credits.js`)

```js
/**
 * credits.js — the credit ledger. The only correctness rule that matters:
 * spend() is atomic (a single UPDATE … WHERE credits > 0 RETURNING), so two
 * concurrent generations can never take the balance below zero. A null return
 * means the decrement matched no row — the user is out.
 */
import { admin } from './supabase.js';

export async function spend(userId) {
  const { data, error } = await admin.rpc('spend_credit', { uid: userId });
  if (error) throw new Error(`spend_credit: ${error.message}`);
  return typeof data === 'number' ? data : null; // null → out of credits
}

export async function refund(userId) {
  const { data, error } = await admin.rpc('add_credit', { uid: userId });
  if (error) throw new Error(`add_credit: ${error.message}`);
  return typeof data === 'number' ? data : null;
}

export async function balance(userId) {
  const { data, error } = await admin
    .from('profiles').select('credits').eq('id', userId).single();
  if (error) throw new Error(`balance: ${error.message}`);
  return data.credits;
}
```

- [ ] **Step 2: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add src/credits.js
git commit -m "feat: credit ledger — atomic spend, refund, balance"
```

---

## Task 4: `src/decks.js` — user-scoped CRUD

**Files:**
- Create: `src/decks.js`

**Interfaces:**
- Consumes: `admin` from `src/supabase.js`; table `decks`.
- Produces (every function scopes by `userId` — a deck that is not the caller's is invisible):
  - `async list(userId): Array<{ id, title, source, updated_at }>`
  - `async get(userId, id): { id, title, source, deck, updated_at } | null`
  - `async create(userId, { title, source, deck }): string` (new id)
  - `async update(userId, id, { title, source, deck }): { id } | null` (null = not theirs)
  - `async remove(userId, id): boolean` (false = not theirs)
- Consumed by: `src/server.js` deck routes.

*Correctness needs a live DB — covered by `scripts/verify-supabase.mjs` (Task 9).*

- [ ] **Step 1: Write the module** (`src/decks.js`)

```js
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
```

- [ ] **Step 2: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add src/decks.js
git commit -m "feat: user-scoped deck CRUD helpers"
```

---

## Task 5: Server wiring — kinds, middleware, meta, route protection

**Files:**
- Modify: `src/server.js` (imports ~L19-28; `STATUS_BY_KIND` L71-94; `/api/meta` L105-131; route definitions)
- Test: `test/server-degraded.test.js`

**Interfaces:**
- Consumes: `hasSupabase`, `publicConfig`, `getUser` (supabase.js); `credits`, `decks` modules.
- Produces: `requireUser(req, res, next)` middleware attaching `req.user = { id, email }`; `STATUS_BY_KIND` gains `unauthorized: 401`, `no_credits: 402`, `not_found: 404`, `server_error: 500`; `/api/meta` gains `supabase: publicConfig()`; `/api/extract|generate|validate|render|defaults` require auth.

- [ ] **Step 1: Write the failing test** (`test/server-degraded.test.js`)

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Import the app with NO Supabase env — the degradation contract.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { app } = await import('../src/server.js');

let base;
let server;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async (p, opts) => {
  const res = await fetch(base + p, opts);
  return { status: res.status, body: await res.json() };
};

test('/api/meta is public and reports supabase:null when unconfigured', async () => {
  const { status, body } = await get('/api/meta');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.supabase, null);
  assert.equal(typeof body.hasApiKey, 'boolean');
});

test('/api/health is public', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('protected routes 401 without a token', async () => {
  for (const p of ['/api/decks', '/api/decks/abc', '/api/defaults']) {
    const { status, body } = await get(p);
    assert.equal(status, 401, `${p} should be 401`);
    assert.equal(body.kind, 'unauthorized');
  }
  const gen = await get('/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(gen.status, 401);
  assert.equal(gen.body.kind, 'unauthorized');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH" && node --test test/server-degraded.test.js`
Expected: FAIL — `/api/meta` has no `supabase` key and `/api/decks` is 404 not 401.

- [ ] **Step 3: Add imports** to `src/server.js` (after L28, the `renderDeck` import):

```js
import { hasSupabase, publicConfig, getUser } from './supabase.js';
import * as credits from './credits.js';
import * as decks from './decks.js';
```

- [ ] **Step 4: Add the new kinds** to `STATUS_BY_KIND` (inside the object, after `bad_deck: 400,`):

```js
  bad_deck: 400,
  // accounts
  unauthorized: 401,
  no_credits: 402,   // Payment Required — out of credits
  not_found: 404,    // deck not yours → 404, never leak existence
  server_error: 500,
```

- [ ] **Step 5: Add `requireUser`** immediately after the `fail` helper (after L97):

```js
/**
 * Gate for the authenticated surface. Absent Supabase config is treated as
 * "not signed in" with a clear message, so an unconfigured server degrades
 * instead of throwing.
 */
async function requireUser(req, res, next) {
  if (!hasSupabase) {
    return fail(res, 'unauthorized', 'This server is not configured for accounts yet.');
  }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = await getUser(token);
  if (!user) return fail(res, 'unauthorized', 'Sign in to continue.');
  req.user = user;
  next();
}
```

- [ ] **Step 6: Extend `/api/meta`** — add one line inside the `res.json({ … })` (after the `hasApiKey:` line):

```js
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    supabase: publicConfig(),
```

- [ ] **Step 7: Protect the authoring routes** — add `requireUser` as middleware on each:

```js
app.get('/api/defaults', requireUser, (req, res) => {
app.post('/api/extract', requireUser, async (req, res) => {
app.post('/api/generate', requireUser, async (req, res) => {
app.post('/api/validate', requireUser, (req, res) => {
app.post('/api/render', requireUser, async (req, res) => {
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH" && node --test test/server-degraded.test.js`
Expected: PASS (all three tests).

- [ ] **Step 9: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add src/server.js test/server-degraded.test.js
git commit -m "feat: auth middleware, meta.supabase, protected routes + degradation test"
```

---

## Task 6: Credit flow in `/api/generate`

**Files:**
- Modify: `src/server.js` (`/api/generate` body, L152-198)

**Interfaces:**
- Consumes: `req.user` (from `requireUser`), `credits.spend`, `credits.refund`.
- Produces: generate spends 1 credit before the model call, refunds on failure, and returns `credits: <remaining>` on success.

*Live-DB correctness (decrement + refund) is proven by `scripts/verify-supabase.mjs` (Task 9). This task keeps the existing degradation test green.*

- [ ] **Step 1: Insert the spend** — after the `if (!text) return fail(res, 'no_input', …)` line, before `const started = …`:

```js
  if (!text) return fail(res, 'no_input', 'Paste some text or a link first.');

  // Spend first: never call the model on an empty balance. spend() is atomic.
  let remaining;
  try {
    remaining = await credits.spend(req.user.id);
  } catch (err) {
    console.error('credit spend failed:', err);
    return fail(res, 'server_error', 'Could not check your credit balance.');
  }
  if (remaining === null) {
    return fail(res, 'no_credits', 'You are out of credits — start from a free template instead.');
  }
```

- [ ] **Step 2: Refund on failure** — change the failure branch:

```js
  if (!result.ok) {
    await credits.refund(req.user.id).catch((e) => console.error('refund failed:', e));
    return fail(res, result.kind, result.message, { notes: result.notes, extracted });
  }
```

- [ ] **Step 3: Return the balance** — add `credits: remaining,` to the success `res.json` (after `deck: result.deck,`):

```js
  res.json({
    ok: true,
    deck: result.deck,
    credits: remaining,
    degraded: result.degraded,
```

- [ ] **Step 4: Verify the degradation test still passes**

Run: `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH" && node --test test/server-degraded.test.js`
Expected: PASS (generate still 401s without a token — the spend code is never reached unauthenticated).

- [ ] **Step 5: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add src/server.js
git commit -m "feat: spend-before-generate with refund-on-failure in /api/generate"
```

---

## Task 7: Deck routes

**Files:**
- Modify: `src/server.js` (add routes after `/api/validate`, before `/api/render`)

**Interfaces:**
- Consumes: `requireUser`, `decks.*`, `credits.balance`, existing `validateDeck`.
- Produces:
  - `GET /api/decks` → `{ ok, decks, credits }`
  - `GET /api/decks/:id` → `{ ok, ...row }` or 404
  - `POST /api/decks` → `{ ok, id }` (validates first)
  - `PUT /api/decks/:id` → `{ ok, id }` or 404 (validates first)
  - `DELETE /api/decks/:id` → `{ ok }` or 404

- [ ] **Step 1: Add the routes** (after the `/api/validate` handler closes):

```js
/**
 * My decks. Every handler is scoped to req.user.id; a deck that is not the
 * caller's is a 404, never a 403 — existence is not leaked. The list carries
 * the credit balance so the dashboard needs one round-trip, not two.
 */
app.get('/api/decks', requireUser, async (req, res) => {
  try {
    const [rows, bal] = await Promise.all([
      decks.list(req.user.id),
      credits.balance(req.user.id),
    ]);
    res.json({ ok: true, decks: rows, credits: bal });
  } catch (err) {
    console.error('decks.list failed:', err);
    fail(res, 'server_error', 'Could not load your decks.');
  }
});

app.get('/api/decks/:id', requireUser, async (req, res) => {
  try {
    const row = await decks.get(req.user.id, req.params.id);
    if (!row) return fail(res, 'not_found', 'No such deck.');
    res.json({ ok: true, ...row });
  } catch (err) {
    console.error('decks.get failed:', err);
    fail(res, 'server_error', 'Could not open that deck.');
  }
});

app.post('/api/decks', requireUser, async (req, res) => {
  const deck = req.body?.deck;
  if (!deck || typeof deck !== 'object') return fail(res, 'bad_deck', 'No deck in the request body.');
  const { valid, errors } = validateDeck(deck);
  if (!valid) return fail(res, 'bad_deck', `Deck is invalid: ${errors.join('; ')}`);
  try {
    const id = await decks.create(req.user.id, {
      title: String(req.body.title ?? deck.title ?? 'Untitled').slice(0, 60),
      source: deck.source === 'template' ? 'template' : 'ai',
      deck,
    });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('decks.create failed:', err);
    fail(res, 'server_error', 'Could not save that deck.');
  }
});

app.put('/api/decks/:id', requireUser, async (req, res) => {
  const deck = req.body?.deck;
  if (!deck || typeof deck !== 'object') return fail(res, 'bad_deck', 'No deck in the request body.');
  const { valid, errors } = validateDeck(deck);
  if (!valid) return fail(res, 'bad_deck', `Deck is invalid: ${errors.join('; ')}`);
  try {
    const row = await decks.update(req.user.id, req.params.id, {
      title: String(req.body.title ?? deck.title ?? 'Untitled').slice(0, 60),
      source: deck.source === 'template' ? 'template' : 'ai',
      deck,
    });
    if (!row) return fail(res, 'not_found', 'No such deck.');
    res.json({ ok: true, id: row.id });
  } catch (err) {
    console.error('decks.update failed:', err);
    fail(res, 'server_error', 'Could not save that deck.');
  }
});

app.delete('/api/decks/:id', requireUser, async (req, res) => {
  try {
    const gone = await decks.remove(req.user.id, req.params.id);
    if (!gone) return fail(res, 'not_found', 'No such deck.');
    res.json({ ok: true });
  } catch (err) {
    console.error('decks.remove failed:', err);
    fail(res, 'server_error', 'Could not delete that deck.');
  }
});
```

- [ ] **Step 2: Run the degradation test** (already asserts `/api/decks` + `/api/decks/abc` 401 without a token)

Run: `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH" && node --test test/server-degraded.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add src/server.js
git commit -m "feat: user-scoped deck routes (list+credits, get, create, update, delete)"
```

---

## Task 8: Frontend — auth, dashboard, credits, save

Frontend is verified with `preview_snapshot` / `preview_inspect` at Task 10 (no DOM unit harness exists; this matches the project's "verify with text, not pixels" rule). Build it as three coherent edits.

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.css`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `/api/meta` `supabase` config; `/api/decks`; `/api/generate` `credits`; deck routes; supabase-js browser SDK.
- Produces: `data-view` ∈ `auth | dashboard | compose | editor`; `document.documentElement.dataset.auth` ∈ `in | out`; `state.user`, `state.credits`, `state.deckId`.

### 8a — `index.html`

- [ ] **Step 1: Header account controls** — replace the `.topbar-right` block (L26-31) with:

```html
  <div class="topbar-right">
    <span class="pill" id="modelPill" title="Model used for Path A">
      <i class="dot"></i><span id="modelName">…</span>
    </span>
    <span class="pill pill-quiet" title="Template-first carousels never call the model">templates · free</span>
    <button class="pill acct" id="dashLink" title="My decks" hidden>My decks</button>
    <span class="pill credits acct" id="creditsPill" title="AI generations left" hidden>
      <b id="creditsNum">–</b>&nbsp;credits
    </span>
    <span class="acct email" id="userEmail" hidden></span>
    <button class="linkbtn acct" id="logoutBtn" hidden>Sign out</button>
  </div>
```

- [ ] **Step 2: Auth view** — add this `<main>` immediately after `</header>`, before `#viewCompose`:

```html
<!-- ================================================================= AUTH -->
<main class="view view-auth" id="viewAuth">
  <section class="authcard">
    <h1>Storyloom</h1>
    <p class="authsub">Text in, carousel out. Sign in to pick up your decks.</p>
    <form id="authForm" data-mode="signin">
      <label>Email<input id="authEmail" type="email" autocomplete="email" required /></label>
      <label>Password<input id="authPassword" type="password" autocomplete="current-password" minlength="6" required /></label>
      <button class="btn-go" id="authSubmit" type="submit">Sign in</button>
      <p class="err" id="authErr" hidden></p>
    </form>
    <button class="linkbtn" id="authToggle">New here? Create an account</button>
    <p class="authnotice" id="authNotice" hidden>
      Accounts aren't configured on this server yet. See <code>docs/setup-supabase.md</code>.
    </p>
  </section>
</main>
```

- [ ] **Step 3: Dashboard view** — add this `<main>` after `#viewAuth`, before `#viewCompose`:

```html
<!-- ============================================================ DASHBOARD -->
<main class="view view-dashboard" id="viewDashboard">
  <div class="dashhead">
    <h1>My decks</h1>
    <button class="btn-go sm" id="newDeckBtn">+ New carousel</button>
  </div>
  <p class="dashempty" id="dashEmpty" hidden>No decks yet. Hit <b>New carousel</b> to make your first.</p>
  <section class="deckgrid" id="deckGrid"></section>
</main>
```

- [ ] **Step 4: Save button** — add to `.editbar-right` (before `#renderBtn`, L116):

```html
      <button class="btn-ghost sm" id="saveBtn">Save</button>
      <button class="btn-go sm" id="renderBtn"><span class="label">Render PNGs</span></button>
```

### 8b — `app.css`

- [ ] **Step 5: View rules** — replace the two `html[data-view=…]` lines (L43-44) with all four + the account-visibility rule:

```css
html[data-view="auth"] .view-auth { display: block; }
html[data-view="dashboard"] .view-dashboard { display: block; }
html[data-view="compose"] .view-compose { display: block; }
html[data-view="editor"] .view-editor { display: block; }

/* account controls in the header show only when signed in */
.acct { display: none; }
html[data-auth="in"] .acct { display: inline-flex; }
```

- [ ] **Step 6: Component styles** — append to the end of `app.css`:

```css
/* ============================================================ AUTH VIEW */
.view-auth { max-width: 420px; margin: 0 auto; padding: 64px 20px; }
.authcard { border: 1px solid var(--line, #2a2a2a); border-radius: 16px; padding: 32px; }
.authcard h1 { margin: 0 0 4px; }
.authsub { color: var(--dim); margin: 0 0 24px; }
#authForm label { display: block; margin-bottom: 14px; font-size: 14px; color: var(--dim); }
#authForm input { display: block; width: 100%; margin-top: 6px; padding: 10px 12px;
  border-radius: 10px; border: 1px solid var(--line, #2a2a2a); background: transparent; color: inherit; font-size: 15px; }
#authForm .btn-go { width: 100%; margin-top: 6px; }
#authToggle { display: block; margin: 16px auto 0; }
.authnotice { margin-top: 20px; color: var(--dim); font-size: 13px; text-align: center; }

/* ========================================================= DASHBOARD VIEW */
.view-dashboard { max-width: 1000px; margin: 0 auto; padding: 40px 20px 90px; }
.dashhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.dashhead h1 { margin: 0; }
.dashempty { color: var(--dim); }
.deckgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.deckcard { border: 1px solid var(--line, #2a2a2a); border-radius: 14px; padding: 16px; cursor: pointer;
  display: flex; flex-direction: column; gap: 8px; transition: border-color .15s; }
.deckcard:hover { border-color: var(--gold, #c8a24a); }
.deckcard h3 { margin: 0; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.deckcard .meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dim); }
.deckcard .del { align-self: flex-end; margin-top: 4px; }

/* header credits pill */
.pill.credits b { color: var(--gold, #c8a24a); }
.email { color: var(--dim); font-size: 13px; align-items: center; }
```

### 8c — `app.js`

- [ ] **Step 7: Extend `state`** (L42-49) — add three fields + the `sb` handle:

```js
const state = {
  meta: null,
  user: null,
  credits: null,
  deckId: null,
  deck: null,
  index: 0,
  warnings: [],
  errors: [],
  compose: { src: 'text', slides: 'auto', narrative: 'listicle', style: 'signature-african', platform: 'linkedin' },
};

let sb = null; // supabase browser client, or null when unconfigured
```

- [ ] **Step 8: Rewrite `api()`** (L52-63) — token, method, central 401:

```js
async function api(path, body, opts = {}) {
  const method = opts.method ?? (body ? 'POST' : 'GET');
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (sb) {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, kind: 'bad_response', message: `${res.status} ${res.statusText}` };
  }
  // Any expired/invalid session flips the whole app back to the auth view.
  if (data && data.ok === false && data.kind === 'unauthorized' && sb) applySession(null);
  return data;
}
```

- [ ] **Step 9: Supabase init + session helpers** — add after `api()`:

```js
// ------------------------------------------------------------------ accounts
async function initSupabase(cfg) {
  if (!cfg) return null;                        // unconfigured server → stay null
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(cfg.url, cfg.anonKey);
  return sb;
}

/** Single source of truth for "who is signed in" → drives the view + header. */
async function applySession(session) {
  state.user = session?.user ?? null;
  document.documentElement.dataset.auth = state.user ? 'in' : 'out';
  if (!state.user) {
    state.credits = null;
    state.deckId = null;
    document.documentElement.dataset.view = 'auth';
    return;
  }
  $('#userEmail').textContent = state.user.email;
  await loadDashboard();                        // sets credits + grid
  document.documentElement.dataset.view = 'dashboard';
}

function renderCredits() {
  if (state.credits == null) return;
  $('#creditsNum').textContent = state.credits;
  const btn = $('#generateBtn');
  const out = state.credits <= 0;
  // don't override the no-API-key disable
  if (state.meta?.hasApiKey) btn.disabled = out;
  $('.cost', btn).textContent = out ? 'no credits' : '1 credit';
}
```

- [ ] **Step 10: Auth + dashboard wiring** — add `wireAuth()`, `loadDashboard()`, `deckCard()`, `openSavedDeck()`, `wireDashboard()`:

```js
function wireAuth() {
  const form = $('#authForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!sb) return;
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const err = $('#authErr');
    err.hidden = true;
    $('#authSubmit').disabled = true;
    const { error } = form.dataset.mode === 'signup'
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });
    $('#authSubmit').disabled = false;
    if (error) { err.hidden = false; err.textContent = error.message; }
    // success → onAuthStateChange fires applySession → dashboard
  };
  $('#authToggle').onclick = () => {
    const to = form.dataset.mode === 'signin' ? 'signup' : 'signin';
    form.dataset.mode = to;
    $('#authSubmit').textContent = to === 'signup' ? 'Create account' : 'Sign in';
    $('#authToggle').textContent = to === 'signup'
      ? 'Have an account? Sign in' : 'New here? Create an account';
    $('#authPassword').autocomplete = to === 'signup' ? 'new-password' : 'current-password';
  };
  $('#logoutBtn').onclick = () => sb?.auth.signOut();
  $('#dashLink').onclick = () => applySession({ user: state.user });
}

async function loadDashboard() {
  const r = await api('/api/decks');
  if (!r.ok) return;
  state.credits = r.credits;
  renderCredits();
  const grid = $('#deckGrid');
  grid.innerHTML = '';
  $('#dashEmpty').hidden = r.decks.length > 0;
  for (const d of r.decks) grid.appendChild(deckCard(d));
}

function deckCard(d) {
  const card = document.createElement('article');
  card.className = 'deckcard';
  card.onclick = () => openSavedDeck(d.id);

  const h = document.createElement('h3');
  h.textContent = d.title || 'Untitled';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const badge = document.createElement('span');
  badge.className = 'badge-source';
  badge.dataset.src = d.source;
  badge.textContent = d.source === 'ai' ? 'AI' : 'Template';
  const when = document.createElement('span');
  when.textContent = new Date(d.updated_at).toLocaleDateString();
  meta.append(badge, when);

  const del = document.createElement('button');
  del.className = 'linkbtn del';
  del.textContent = 'Delete';
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${d.title || 'Untitled'}"?`)) return;
    const r = await api('/api/decks/' + d.id, null, { method: 'DELETE' });
    if (r.ok) card.remove();
  };

  card.append(h, meta, del);
  return card;
}

async function openSavedDeck(id) {
  const r = await api('/api/decks/' + id);
  if (!r.ok) return;
  openEditor(r.deck, { deckId: r.id });
}

function wireDashboard() {
  $('#newDeckBtn').onclick = () => { state.deckId = null; document.documentElement.dataset.view = 'compose'; };
}
```

- [ ] **Step 11: Save flow** — add `saveDeck()`:

```js
async function saveDeck() {
  const btn = $('#saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const payload = { title: state.deck.title || 'Untitled', deck: state.deck };
  const r = state.deckId
    ? await api('/api/decks/' + state.deckId, payload, { method: 'PUT' })
    : await api('/api/decks', payload);
  btn.disabled = false; btn.textContent = 'Save';
  if (!r.ok) { $('#stageNote').textContent = `Save failed — ${r.message}`; return; }
  state.deckId = r.id ?? state.deckId;
  btn.textContent = 'Saved ✓';
  setTimeout(() => (btn.textContent = 'Save'), 1500);
}
```

- [ ] **Step 12: `openEditor` records the id** — change the signature/body (L379-382):

```js
function openEditor(deck, info = {}) {
  state.deck = deck;
  state.index = 0;
  state.deckId = info.deckId ?? null;
  document.documentElement.dataset.view = 'editor';
```

- [ ] **Step 13: Wire Save + back-to-dashboard** — in `wireEditor()`:

```js
  $('#backBtn').onclick = () => {
    state.deckId = null;
    document.documentElement.dataset.view = state.user ? 'dashboard' : 'compose';
    if (state.user) loadDashboard();
  };
```
and alongside the `#renderBtn` wiring:
```js
  $('#saveBtn').onclick = saveDeck;
  $('#renderBtn').onclick = renderPngs;
```

- [ ] **Step 14: Rework `boot()`** — replace the tail of `boot()` (from `wireCompose();` to the closing brace) with:

```js
  wireCompose();
  wireEditor();
  wireAuth();
  wireDashboard();
  loadGallery();

  await initSupabase(meta.supabase);
  if (!sb) {
    // No accounts configured — degrade to today's single-user behavior, but
    // make the reason discoverable if someone lands on the auth view.
    $('#authNotice').hidden = false;
    document.documentElement.dataset.auth = 'out';
    document.documentElement.dataset.view = 'compose';
    return;
  }
  sb.auth.onAuthStateChange((_e, session) => applySession(session));
  const { data } = await sb.auth.getSession();
  applySession(data?.session ?? null);
}
```

- [ ] **Step 15: Credits after a generate** — in `generate()` success path, just before `openEditor(result.deck, result)`:

```js
  if (typeof result.credits === 'number') { state.credits = result.credits; renderCredits(); }
  openEditor(result.deck, result);
```

- [ ] **Step 16: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add public/index.html public/app.css public/app.js
git commit -m "feat: auth + dashboard + credits pill + explicit save (frontend)"
```

---

## Task 9: Verification script + setup doc

**Files:**
- Create: `scripts/verify-supabase.mjs`
- Create: `docs/setup-supabase.md`

**Interfaces:**
- Consumes: a live, configured `.env` + a running server on `:3000`.
- Produces: pass/fail proof of the credit + deck contract that cannot be unit-tested without keys.

- [ ] **Step 1: Write the setup doc** (`docs/setup-supabase.md`)

```markdown
# Supabase setup (~10 min, ₦0)

1. Create a free project at supabase.com. Wait for it to provision.
2. **Settings → API** — copy the **Project URL**, the **anon public** key, and
   the **service_role** key.
3. Append them to `.env` (never commit `.env`):

       SUPABASE_URL=https://YOUR-PROJECT.supabase.co
       SUPABASE_ANON_KEY=eyJ...            # anon public
       SUPABASE_SERVICE_ROLE_KEY=eyJ...    # service_role — SECRET

4. **Authentication → Providers → Email** — turn **OFF** "Confirm email"
   (instant signup for local dev).
5. **SQL Editor** — paste and run `supabase/migrations/0001_auth_credits_decks.sql`.
6. Restart the dev server. `/api/meta` now returns a `supabase` block and the
   app shows the sign-in screen.
7. Prove it end-to-end: `npm start` in one shell, then
   `node scripts/verify-supabase.mjs` in another.
```

- [ ] **Step 2: Write the verification script** (`scripts/verify-supabase.mjs`)

```js
/**
 * verify-supabase.mjs — end-to-end proof of the account contract.
 * Requires a configured .env, the migration applied, and `npm start` running.
 * Uses the anon key to sign up two throwaway users, then drives the API the
 * way the browser does (Bearer token) to prove credits + deck scoping.
 */
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile();

const BASE = 'http://localhost:3000';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Set up .env first.'); process.exit(1); }

const anon = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const rand = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log(`PASS  ${name}`)) : (fail++, console.error(`FAIL  ${name}`)); };

async function signUp() {
  const sb = anon();
  const email = rand();
  const { data, error } = await sb.auth.signUp({ email, password: 'password123' });
  if (error) throw new Error(`signup: ${error.message}`);
  return { token: data.session.access_token, email };
}
const call = (token, path, body, method) => fetch(BASE + path, {
  method: method ?? (body ? 'POST' : 'GET'),
  headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const A = await signUp();
const B = await signUp();

// unauthenticated
ok('no token → 401', (await call(null, '/api/decks')).status === 401);

// starting balance is 10
const decks0 = await call(A.token, '/api/decks');
ok('new user has 10 credits', decks0.body.credits === 10);
ok('new user has no decks', Array.isArray(decks0.body.decks) && decks0.body.decks.length === 0);

// deck CRUD + scoping
const sample = { style_id: 'signature-african', narrative_type: 'manual', platform: 'linkedin',
  title: 'Verify', source: 'ai', slides: [
    { type: 'hook', heading: 'Hi' }, { type: 'point', heading: 'A', body: 'x' },
    { type: 'point', heading: 'B', body: 'y' }, { type: 'point', heading: 'C', body: 'z' },
    { type: 'cta', heading: 'Go', cta: { label: 'Follow' } },
  ] };
const created = await call(A.token, '/api/decks', { title: 'Verify', deck: sample });
ok('A can create a deck', created.body.ok && created.body.id);
const id = created.body.id;
ok("B cannot open A's deck (404)", (await call(B.token, '/api/decks/' + id)).status === 404);
ok("B cannot delete A's deck (404)", (await call(B.token, '/api/decks/' + id, null, 'DELETE')).status === 404);
ok('A can open own deck', (await call(A.token, '/api/decks/' + id)).body.ok);

// generate spends a credit (needs GEMINI key); otherwise refunds to 10
if ((await call(A.token, '/api/decks')).body.credits === 10) {
  const gen = await call(A.token, '/api/generate', { text: 'Three quick tips for junior devs shipping their first feature.' });
  if (gen.body.ok) {
    ok('generate returned a balance of 9', gen.body.credits === 9);
    ok('balance persisted at 9', (await call(A.token, '/api/decks')).body.credits === 9);
  } else {
    ok('generate failed → credit refunded to 10', (await call(A.token, '/api/decks')).body.credits === 10);
    console.log(`   (generate failed with ${gen.body.kind}: ${gen.body.message})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Commit**

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git add scripts/verify-supabase.mjs docs/setup-supabase.md
git commit -m "docs: supabase setup checklist + end-to-end verification script"
```

---

## Task 10: Full-suite run + degraded preview + final commit

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH" && npm test`
Expected: all node:test files PASS (supabase degradation + server degradation).

- [ ] **Step 2: Boot the dev server** with `preview_start` (name `storyloom`).

- [ ] **Step 3: Verify the degraded app** with `preview_snapshot`:
  - `/api/meta` reports `supabase: null` (server still boots).
  - The app lands on the **compose** view (degraded), not a broken auth screen.
  - `preview_console_logs` — no uncaught errors from the missing SDK/config.

- [ ] **Step 4: Regression guard** — confirm `templates/carousel.html` is unchanged:

```bash
export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"
git status --porcelain templates/carousel.html   # expect no output
```

- [ ] **Step 5: One screenshot** (`preview_screenshot`) to show the state, then stop the preview server.

- [ ] **Step 6: Final note** — the live auth/credits/deck flow is verified by `scripts/verify-supabase.mjs` once keys land (Task 9); everything else is green now.

---

## Self-Review

**Spec coverage:**
- Accounts (email+password, confirm off) → Task 1 (trigger), Task 8c (signUp/signIn), doc Task 9. ✓
- One-time 10 free credits → migration default + trigger (Task 1). ✓
- 1 credit per successful AI generation, templates free → Task 6 (spend/refund in generate only; `/api/defaults` never spends). ✓
- Server is sole authority (service-role, atomic) → Tasks 2/3/6. ✓
- Deck persistence, explicit Save, JSON rows → Tasks 4/7/8c. ✓
- Approach A (browser SDK for auth only, Bearer to Express) → Task 8c `api()` + `initSupabase`. ✓
- Auth-gated app, no session → auth, session → dashboard → Task 8c `applySession`; degraded → compose. ✓
- New `STATUS_BY_KIND` (401/402/404) → Task 5 (+ `server_error: 500`; also fixes the pre-existing SPA-404 fallthrough where `not_found` was absent). ✓
- `/api/meta` returns public supabase config → Task 5. ✓
- RLS owner-only → Task 1. ✓
- Secrets discipline, `.env.example` empty keys → Task 0 + Global Constraints. ✓
- Invariants (template untouched, single validator, envelope, one browser) → Global Constraints + Task 10 regression guard. ✓
- Testing text-first (server script + preview) → Tasks 5/9/10. ✓

**Placeholder scan:** every code step carries real content; no TBD/TODO/"handle errors". ✓

**Type consistency:** `spend()→number|null`, `refund()→number|null`, `balance()→number`; `decks.get/update` use `maybeSingle` and return `null` for "not theirs"; `api(path, body, opts)` 3-arg signature used consistently by deck calls; `applySession(session)`, `openEditor(deck, {deckId})`, `state.deckId/credits/user` names match across 8c. ✓

**Deviations from spec (intentional, minor):**
1. Added kind `server_error: 500` for DB-layer failures (spec listed only 401/402/404). Distinguishes "our fault" from client errors.
2. `GET /api/decks` returns `{ decks, credits }` in one round-trip rather than a separate credits endpoint — consistent with the spec's bootstrap ("GET /api/decks + credits").
3. When Supabase is unconfigured the SPA degrades to **compose** (today's behavior) instead of a dead auth view — required by the graceful-degradation constraint.
