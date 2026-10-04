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
5. [`supabase/migrations/0005_catalog_updated_at.sql`](../supabase/migrations/0005_catalog_updated_at.sql)
6. [`supabase/migrations/0006_brand_logos.sql`](../supabase/migrations/0006_brand_logos.sql)
7. [`supabase/migrations/0007_feedback.sql`](../supabase/migrations/0007_feedback.sql)
8. [`supabase/migrations/0008_template_versions.sql`](../supabase/migrations/0008_template_versions.sql)
9. [`supabase/migrations/0009_universal_style_settings.sql`](../supabase/migrations/0009_universal_style_settings.sql)

The migrations are safe to rerun on an existing project. Together they create or repair:

- `profiles` - one row per auth user, with `email`, `credits`, `created_at`, and
  `updated_at`.
- `decks` - one JSON deck per row, owned by a user.
- `brands` - reusable brand details, plus the `profiles.plan` field.
- `brand-logos` - public PNG/JPEG/WebP brand images, limited to 2 MB and scoped
  to the uploading user's storage folder.
- `feedback` - private user suggestions, bug reports, questions, and enquiries;
  submissions and admin status changes go through the server API. The admin inbox
  currently loads the latest 200 submissions.
- `styles` - admin-published visual token sets for color, heading/content fonts, and role-specific text sizes; the three built-in skins remain available without database rows. Template composition stays with the deck.
- `starter_templates` - admin-published, schema-validated starter decks shown beside the built-ins. Published revisions are immutable; republishing creates the next version.
- catalog draft snapshots and `updated_at` timestamps used by admin editing.
- a signup trigger that grants every new user their 50 credits.
- a backfill step for auth users that already existed before the trigger worked.
- `ensure_profile`, `spend_credit`, and `add_credit` RPCs.
- owner-only RLS policies.
- feedback row-level policies: users can read only their own submissions and
  admins can read all feedback. Feedback writes are server-only.

The browser resizes uploaded logos to at most 512 pixels on the longest side
and converts them to WebP when resizing is needed or the WebP is smaller. This
keeps the footer image lightweight without replacing a smaller original when
conversion would make it larger.

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

To let users enter Storyloom immediately after signing up, open
**Authentication -> Sign In / Providers -> Email** and turn **Confirm email**
off. With confirmation disabled, Supabase returns a session at signup and the
app signs the new user in automatically. If you leave it on, users must confirm
their email before they can sign in.

When email confirmation is on, open **Authentication -> URL Configuration**:

1. Set **Site URL** to `https://storyloom-8hz9.onrender.com`.
2. Add `https://storyloom-8hz9.onrender.com/signin` and
  `http://localhost:3000/signin` to **Redirect URLs**. To preserve a requested
  deep link through email confirmation, also allow
  `https://storyloom-8hz9.onrender.com/signin?next=*` and
  `http://localhost:3000/signin?next=*`.

Signup and resend use the current site's `/signin` URL, so production links
return to Render and local test links return to localhost. The `next` value is
restricted by the app to known same-origin Storyloom routes. Add equivalent
entries for any custom domain. On the signup screen, **Resend confirmation
email** can send a fresh link for an existing unconfirmed account; enter the
email address first.
If a customized confirmation email template builds its own redirect URL, use
`{{ .RedirectTo }}` instead of `{{ .SiteURL }}` so it honors the requested site.
Check the **Reset Password** email template too: its link should use
`{{ .ConfirmationURL }}`. Do not hardcode the project Site URL as the callback;
that sends recovery links to `/` instead of `/signin`.

## 5. Grant admin access

Signing in does not make an account an admin automatically. The **Templates**
button appears only when that user's `public.profiles.is_admin` value is `true`.
In the Supabase SQL Editor, first check the profile row for the email used to
sign in:

```sql
select id, email, is_admin
from public.profiles
where email = 'admin@example.com';
```

If the row exists and `is_admin` is false, grant access to that exact account:

```sql
update public.profiles
set is_admin = true
where email = 'admin@example.com';
```

Use the account's actual sign-in email in both queries. If the first query
returns no rows, sign in to Storyloom with that account once so its profile is
created, then run the queries again. Refresh Storyloom after granting access;
**Templates** will appear in the top-right navigation. Admin API routes enforce
the same profile flag on the server.

## 6. Verify

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
