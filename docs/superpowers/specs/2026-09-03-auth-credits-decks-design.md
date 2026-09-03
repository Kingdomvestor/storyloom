# Storyloom — Auth, Credits & Deck Persistence

**Date:** 2026-09-03
**Status:** Design approved; implementation to follow.
**Scope:** the "authenticated core product" — 4 pages: Dashboard/My decks (net-new), Compose, Editor, Render result.

## Goal

Put the existing compose → generate → edit → preview → render flow behind
accounts, enforce a free-credit budget on AI generation **server-side**, and
persist each user's decks so "My decks" is real. Local dev only
(`localhost:3000` + a hosted Supabase free-tier project); deployment deferred.

## Decisions (locked during brainstorm, 2026-09-03)

- **Supabase:** hosted free-tier project. The app runs on localhost and talks
  to Supabase over HTTPS. No Docker. The same project carries over unchanged at
  deploy time.
- **Auth:** email + password, email confirmation **OFF** (instant signup). No
  password reset, email verification, or OAuth in this slice.
- **Credits:** one-time free grant of **10** on signup. No auto-refill. **1
  credit per *successful* AI generation.** Templates (Path B) are always free.
- **Persistence:** decks are JSON rows in Postgres (no Storage bucket).
  **Explicit Save** via a button — no autosave.
- **Integration — Approach A:** `@supabase/supabase-js` runs in the browser for
  the **auth lifecycle only** (signup / login / refresh / logout). The SPA sends
  the access token as `Authorization: Bearer …`. **Express is the sole authority
  on credits and decks**, using the secret service-role key, doing an atomic
  check-and-decrement co-located with the Gemini call.
- **The app is authenticated:** no session → auth view; session → dashboard.

## Out of scope (Week B / later — do not build)

autosave · reorder · add/remove slides · undo/redo · download/zip/PDF ·
watermark enforcement · saved brand kit auto-applied · paid billing · password
reset · OAuth · deployment.

## Invariants preserved (must not break)

- `templates/carousel.html` stays **byte-for-byte untouched** — one template,
  two consumers (preview iframe + Puppeteer).
- `schemas/carousel.schema.json` remains the single source of truth. Deck save
  reuses the existing `validateDeck`; no second validator is introduced.
- Every response stays `{ ok: true, … }` or `{ ok: false, kind, message }`;
  `STATUS_BY_KIND` maps kind → HTTP status.
- One persistent Puppeteer browser via `queueRender()`.

---

## Data model

Created once via `supabase/migrations/0001_auth_credits_decks.sql`, run in the
Supabase SQL editor. Tables:

- **`auth.users`** — Supabase-managed (email/password identities). Not created
  by us.
- **`public.profiles`** — 1:1 with `auth.users`:
  - `id uuid primary key references auth.users(id) on delete cascade`
  - `credits int not null default 10 check (credits >= 0)`
  - `created_at timestamptz not null default now()`
  - A trigger `handle_new_user()` inserts a `profiles` row on every signup, so a
    new account starts at 10 credits automatically.
- **`public.decks`**:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `title text not null default 'Untitled'`
  - `source text not null default 'ai'` — `'ai'` or `'template'`
  - `deck jsonb not null` — the validated deck
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
  - index on `(user_id, updated_at desc)` for the dashboard list.

**Atomic credit spend** — one statement, no check-then-decrement race:

```sql
create function public.spend_credit(uid uuid) returns int
language sql security definer as $$
  update public.profiles set credits = credits - 1
  where id = uid and credits > 0
  returning credits;
$$;
```

Returns the new balance, or no row when the user is out. Refund on failure is
the mirror (`credits + 1`), exposed as `add_credit(uid)` or a plain update.

**RLS** — enabled on both tables with owner-only policies
(`auth.uid() = id` / `auth.uid() = user_id`). This is defense in depth: Express
is the real gate (service-role key bypasses RLS and scopes every query by
`user_id` itself), but if the public key ever touched the DB directly, rows stay
private.

## Server

Three new focused modules + edits to `src/server.js`:

- **`src/supabase.js`** — builds the service-role admin client from
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; exposes `getUser(token)` for
  verification. Exports `hasSupabase` (all env present) so the app degrades
  gracefully when unconfigured — mirroring the existing `hasApiKey` pattern.
- **`src/credits.js`** — `spend(userId)` / `refund(userId)` / `balance(userId)`.
- **`src/decks.js`** — deck CRUD helpers, every query scoped by `user_id`.

**Auth middleware `requireUser`:** reads `Authorization: Bearer <token>`, calls
`getUser`. Missing/expired → `fail(res, 'unauthorized', …)`. Valid → attaches
`req.user = { id, email }`.

**New `STATUS_BY_KIND` entries:** `unauthorized: 401`, `no_credits: 402`
(Payment Required), `not_found: 404` (deck not yours → 404, never leak
existence).

**Route map after changes:**

- *Public:* `/api/meta` (extended to also return the public `supabase.url` +
  `anonKey`), `/api/health`.
- *Auth required:* `/api/extract`, `/api/generate`, `/api/validate`,
  `/api/render`, `/api/defaults` (templates still spend no credit).
- *New, auth required, scoped to `req.user.id`:*
  - `GET /api/decks` — list (id, title, source, updated_at) for the dashboard.
  - `GET /api/decks/:id` — open (404 if not yours).
  - `POST /api/decks` — validate (`validateDeck`) then insert; returns `id`.
  - `PUT /api/decks/:id` — validate then update (404 if not yours).
  - `DELETE /api/decks/:id`.

**Credit flow in `/api/generate`** (the one part that must be exactly right):

1. `requireUser` → `req.user`.
2. Resolve `text` (existing logic, URL extract included).
3. **Spend first:** `credits.spend(user.id)`. No remaining →
   `fail(res, 'no_credits', …)` **before** any Gemini call.
4. `generateDeck(...)` (unchanged).
5. On failure → **`credits.refund(user.id)`**, then return the existing error.
   No charge for our/upstream's failure.
6. On success → return the deck as today **plus `credits: <remaining>`** so the
   UI updates the balance without a second request.

When Supabase is unconfigured (`hasSupabase === false`), protected routes return
`unauthorized` with a clear "server not configured for accounts yet" message,
and `/api/meta` reports `supabase: null` so the client shows a setup notice
rather than a broken login.

## Frontend

All views live in the single `public/index.html` as `<main>` sections (like the
existing `#viewCompose` / `#viewEditor`). **No new HTML files.**
`templates/carousel.html` is untouched.

**Views:** `data-view` grows to `auth | dashboard | compose | editor`.

- **`#viewAuth`** — one card, email + password, toggle Sign in / Sign up.
- **`#viewDashboard`** (net-new) — "My decks" grid (title, `ai`/`template`
  badge, updated date; click → open in editor; delete affordance), a
  credits-remaining pill, and a prominent **New** button → compose. Empty state.
- **`#viewCompose` / `#viewEditor`** — small additions below.

**Session bootstrap on load:**

1. `GET /api/meta` → public `supabase.url` + `anonKey`; init supabase-js (CDN
   ESM import, no build step).
2. Ask the SDK for the persisted session → none = auth view; present = set
   `state.user`, `GET /api/decks` + credits, dashboard view.
3. Subscribe to `onAuthStateChange` so logout/expiry flips back to auth.

**`api()` becomes the single auth chokepoint:** each call reads a fresh access
token from the SDK (auto-refreshed) and attaches `Authorization: Bearer …`. Any
`401 unauthorized` → clear session, flip to auth view.

**Auth actions** call the SDK directly; success runs the bootstrap path.
**Logout** in the header → `signOut` → auth view.

**Compose:** the "1 credit" button becomes real — disabled with a hint when
`credits === 0`, pointing at free templates; after a successful generate,
`state.credits` updates from the response.

**Editor — explicit Save:** a **Save** button in the editbar. No `id` yet →
`POST /api/decks`, store returned `id`; thereafter → `PUT /api/decks/:id`.
Opening a deck from the dashboard seeds `state.deckId`; "← New" clears it. A
template becomes "yours" the moment you Save.

**Header:** add a credits pill and a small logout control; existing model +
templates pills stay.

## Secrets (same discipline as the Gemini key)

Supabase exposes three values:

- `SUPABASE_URL` + `SUPABASE_ANON_KEY` — **public by design**, safe to send to
  the browser (RLS protects data).
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**, server-only, bypasses RLS. Lives
  only in `.env` (gitignored). Never in the browser, a screenshot, or
  `.env.example`.

`.env.example` gains all three keys, **empty-valued** (committable).
`.env` is appended to via heredoc; never read into context.

## Testing & rollout

**One-time Supabase setup (user, ~10 min, ₦0):**

1. Create a free project; Settings → API → copy URL, anon key, service-role key.
2. Append the three keys to `.env`; the three empty keys are already in
   `.env.example`.
3. Auth → Providers → Email → turn **off** "Confirm email".
4. Run `supabase/migrations/0001_auth_credits_decks.sql` in the SQL editor.

**Verification (text-first):**

- **Server script** (`node -e` / small script) hits each endpoint with and
  without a token — proving `unauthorized` (401), a real token works,
  `spend_credit` decrements, generate **refunds** on a forced failure, and deck
  CRUD is user-scoped (user B gets 404 on user A's deck). Credit correctness is
  proven here, not in pixels.
- **Preview flow:** `preview_snapshot` — auth view renders → sign up → dashboard
  with 10 credits → New → generate → credits 9 → Save → deck on dashboard →
  reload → still logged in, deck present. `preview_inspect` for the credits
  value. One screenshot at the end.
- **Regression guard:** `templates/carousel.html` unchanged; render sheet still
  works.

**Rollout order (all local, each step keeps the app runnable):** migration +
env → server modules + middleware → deck CRUD → credit flow in generate → auth
& dashboard views → save flow → verify.
