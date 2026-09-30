# Wiring Storyloom to Supabase

Storyloom runs fine **without** Supabase. It falls back to the single-user flow
(compose -> generate -> edit -> render) with no accounts, credits, or saved
decks. `/api/meta` reports `supabase: null` and the UI hides the account
controls. That degraded path is covered by `npm test`.

To turn on accounts + one-time free credits (50) + deck persistence, do this
once. It takes about five minutes and costs nothing on the Supabase free tier.

## 1. Create a free project

1. Sign in at [supabase.com](https://supabase.com) and create a new project.
2. Set a database password and pick a region near you.
3. Wait for provisioning to finish.

## 2. Run or rerun the migration

Open **SQL Editor -> New query** and run the migrations in order:

1. [`supabase/migrations/0001_auth_credits_decks.sql`](../supabase/migrations/0001_auth_credits_decks.sql)
2. [`supabase/migrations/0002_brands_plan.sql`](../supabase/migrations/0002_brands_plan.sql)
3. [`supabase/migrations/0003_styles_admin.sql`](../supabase/migrations/0003_styles_admin.sql)
4. [`supabase/migrations/0004_starter_templates.sql`](../supabase/migrations/0004_starter_templates.sql)

Both migrations are safe to rerun on an existing project. Together they create or repair:

- `profiles` - one row per auth user, with `email`, `credits`, `created_at`, and
  `updated_at`.
- `decks` - one JSON deck per row, owned by a user.
- `brands` - reusable brand details, plus the `profiles.plan` field.
- `styles` - admin-published visual token sets; the three built-in skins remain available without database rows.
- `starter_templates` - admin-published, schema-validated starter decks shown beside the built-ins.
- a signup trigger that grants every new user their 50 credits.
- a backfill step for auth users that already existed before the trigger worked.
- `ensure_profile`, `spend_credit`, and `add_credit` RPCs.
- owner-only RLS policies.

Important: `auth.users` is managed by Supabase and will not show under the
normal `public` schema table list. `public.profiles.id` is intentionally the
same UUID as `auth.users.id`; the new `profiles.email` column is there so the
public table editor is readable.

## 3. Add the keys to `.env`

In the dashboard, open **Project Settings -> API**. Copy three values into
`.env`:

| `.env` variable | Dashboard field | Secret? |
|---|---|---|
| `SUPABASE_URL` | Project URL | public |
| `SUPABASE_ANON_KEY` | `anon` / `public` key | public |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` / `secret` key | **secret** |

If those lines are not already in `.env`, append them, then paste each value
after its `=`:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The `service_role` key bypasses all row-level security. It is server-only:
never commit it, never paste it into chat, and keep it out of screenshots.

## 4. Auth setting

For the smoothest local test, open **Authentication -> Sign In / Providers ->
Email** and turn **Confirm email** off. If you leave email confirmation on,
signup still works, but the app will ask you to confirm the email before you can
sign in.

When email confirmation is on, open **Authentication -> URL Configuration**:

1. Set **Site URL** to `https://storyloom-8hz9.onrender.com`.
2. Add `https://storyloom-8hz9.onrender.com/signin` and
  `http://localhost:3000/signin` to **Redirect URLs**.

Signup and resend use the current site's `/signin` URL, so production links
return to Render and local test links return to localhost. Add any custom domain
here as well. On the signup screen, **Resend confirmation email** can send a
fresh link for an existing unconfirmed account; enter the email address first.
If a customized confirmation email template builds its own redirect URL, use
`{{ .RedirectTo }}` instead of `{{ .SiteURL }}` so it honors the requested site.

## 5. Verify

```bash
npm run verify:supabase
```

This creates a throwaway user and checks that the signup trigger creates a
profile row with the email and 50 credits, that spend/refund are atomic, and
that deck CRUD is scoped to the owner. It then deletes the throwaway user.

Restart the server (`npm start`) and the account routes are live. Remove the
Supabase keys again and Storyloom degrades straight back to the single-user
flow.

## How it fits together

- The **browser** uses the `anon` key only to sign users in/up and hold a
  session, then sends the session token as `Authorization: Bearer ...`.
- The **server** is the sole authority on credits and decks. It verifies the
  token, then acts through the `service_role` client.
- A credit is spent before the Gemini call and refunded if generation fails.
- The server also repairs a missing `profiles` row for a valid auth user, so an
  old or half-applied database setup does not strand that account.
