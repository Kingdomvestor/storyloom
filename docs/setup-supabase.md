# Wiring Storyloom to Supabase

Storyloom runs fine **without** Supabase — it falls back to the single-user
Week A flow (compose → generate → edit → render) with no accounts, credits, or
saved decks. `/api/meta` reports `supabase: null` and the UI hides the account
controls. That degraded path is covered by `npm test`.

To turn on accounts + one-time free credits (10) + deck persistence, do this
once. It takes about five minutes and costs nothing (Supabase free tier).

## 1. Create a free project

1. Sign in at [supabase.com](https://supabase.com) and create a new project.
2. Set a database password and pick a region near you.
3. Wait for provisioning to finish (~2 min).

## 2. Run the migration

Open **SQL Editor → New query**, paste the entire contents of
[`supabase/migrations/0001_auth_credits_decks.sql`](../supabase/migrations/0001_auth_credits_decks.sql),
and run it. **"Success. No rows returned" is the expected result** — the script
is all table / function / trigger / policy creation, with nothing to `SELECT`.

It creates:

- `profiles` — one row per user, `credits` defaulting to 10 (checked `>= 0`).
- `decks` — one JSON deck per row, owned by a user.
- a signup trigger that grants every new user their 10 credits.
- `spend_credit` / `add_credit` — atomic, race-safe credit updates.
- owner-only RLS policies (defense in depth; the server acts via the service role).

## 3. Add the keys to `.env`

In the dashboard: **Project Settings → API**. Copy three values into `.env`:

| `.env` variable | Dashboard field | Secret? |
|---|---|---|
| `SUPABASE_URL` | Project URL | public |
| `SUPABASE_ANON_KEY` | `anon` `public` key | public |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` `secret` key | **secret** |

If those lines aren't already in `.env`, append them, then paste each value
after its `=`:

```bash
cat >> .env <<'EOF'
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
EOF
```

> ⚠️ **The `service_role` key bypasses all row-level security.** It is
> server-only — never commit it, never paste it into chat, and keep it off any
> build-in-public screenshot. The URL and `anon` key are public by design (they
> ship to the browser); the `service_role` key never leaves the server.

## 4. Verify

```bash
npm run verify:supabase
```

This creates a throwaway user and checks that signup grants 10 credits, that
spend/refund are atomic and floor at 0, and that deck CRUD is scoped to the
owner — then deletes the user. Expect **13/13 ✔**. It prints only PASS/FAIL,
never a key.

Restart the server (`npm start`) and the account routes are live. Remove the
keys again and Storyloom degrades straight back to the single-user flow —
nothing breaks.

## How it fits together

- The **browser** uses the `anon` key only to sign users in/up and hold a
  session, then sends the session token as `Authorization: Bearer …`.
- The **server** is the sole authority on credits and decks. It verifies the
  token, then acts through the `service_role` client. A credit is spent
  *before* the Gemini call and refunded if generation fails.
- **No keys?** `hasSupabase()` is false, the account routes refuse, and the app
  serves the single-user flow. Env is read lazily (never at import), so adding
  keys and restarting is all it takes to switch modes.
