# Storyloom — feature ledger

Where the build actually stands. Not the plan (that's
`content-to-visual-generator-summary.md`) and not the agent's private memory —
this is the running score, updated whenever work lands or scope moves.

**Ship target:** Sept 20, 2026 · **Last updated:** 2026-10-03 · Budget: ₦0

---

## Shipped

### Week A — render engine + web app (Aug 31–Sep 6)
- `schemas/carousel.schema.json` as the single source of truth; `/api/meta` reads
  enums, slide bounds and char caps off it.
- `validate.js` — one Ajv instance + lint + `repairDeck()` (repair, never refuse).
- `templates/carousel.html` at 1080×1350, one file serving both the preview iframe
  and Puppeteer. Untouched since the initial commit.
- `render.js` → PNG set on disk. One persistent browser, renders serialized.
- `generate.js` — Gemini JSON mode + Ajv + retry/fallback; `prompts/v1.md`.
- Express API, compose UI, live iframe preview, URL input → Readability,
  Path B template gallery (3 fixtures).
- All three skins: `signature-african`, `editorial-clean`, `mono-terminal`.
  Live style swap in the editor — same JSON, different stylesheet.
- `highlight_words` tag editor with schema-derived caps.
- Form panel tabs: Content · Style · Brand.

### Pulled forward from Week B — accounts (Sep 2–3)
- Supabase magic-link auth; `requireUser` soft gate on the authoring surface,
  `requireAccount` hard gate on the deck store. Degrades to single-user Week A
  when Supabase is unconfigured.
- **Auth transition consistency (Oct 2).** On boot/sign-in, keep the loading
  view visible until deck and credit data are ready; hide account chrome on
  loading/auth views so a signed-in header cannot appear beside the sign-in form.
- **Render browser install (Oct 2).** npm `postinstall` and `prestart` install
  the Puppeteer-pinned Chrome build. `prestart` ensures it exists in the runtime
  cache before Render launches the server, for slide previews and downloads.
- **Rendered slide cache (Oct 2).** A bounded, deck-keyed in-memory cache reuses
  1080×1350 PNGs across preview and download requests. Missing slides render
  incrementally; Chrome remains serialized to protect low-memory instances.
- **Signup confirmation redirects (Sep 30).** Signup and resend return to the
  current site's `/signin` page instead of relying on Supabase's Site URL
  fallback; production and local callback URLs are documented for the allow-list.
- Credits: server-side spend on generate, refund on failure, block at 0.
- User-scoped deck CRUD + dashboard of saved decks + explicit Save button.
- **My Decks dashboard polish (Sep 30).** Kept the existing signed-in landing route;
  clarified the workspace heading and empty state, replaced click-only cards with
  named keyboard-operable Open buttons, and refreshes the deck list after deletion.
  Browser coverage checks the accessible action and no horizontal overflow at 390px.
- **Deck environment visual pass (Oct 1).** The dashboard now shares the landing
  page's content/header alignment, with a two-part welcome/action hero, bright
  create panel, live saved-deck count, and saved cards kept directly below.
- `scripts/verify-supabase.mjs` (13/13 live) and `docs/setup-supabase.md`.

### Week B — editor (Sep 4)
- **Drag-to-reorder on the slide rail.** Shield overlay so the live iframe in each
  thumb can't swallow the drag; types re-derive by position on drop, mirroring
  `repairDeck()` so a reordered deck always validates.
- **Add / remove slides.** Rail footer with `+` / `−` and an `n/max` count. Bounds
  come from the schema via `/api/meta`, so the buttons disable at 5 and 10 rather
  than letting the UI author an invalid deck — same idea as `maxLength` on the
  inputs. Add inserts *before* the cta (appending would demote the author's closing
  slide), and every insert or delete re-derives types by position.
- **`npm run dev:degraded`** (`scripts/dev-degraded.mjs`) — boots the same app with
  the Supabase vars cleared, so the authoring surface is open and the editor can be
  driven without a signed-in session. Every remaining UI feature needs this.
- **Undo / redo.** `revalidate()` was already the one choke point every mutation
  passes through, so history hangs off it rather than off 30 call sites: it pushes a
  snapshot (900ms coalesce so typing is one entry, cap 60) and marks the deck dirty.
  `{passive:true}` skips the bookkeeping, `{discrete:true}` forces its own entry —
  which is what makes one Ctrl+Z undo an AI rewrite exactly.
- **Autosave.** 2s after the last change: POST on first save, PUT after, with the
  state shown in the editbar. AI-generated decks enter autosave as soon as they
  open, so a generation is not lost if the user leaves before editing. Template
  browsing remains read-only; template decks autosave only after an edit. Explicit
  Save remains available.
- **Autosave reliability (Sep 29).** Writes serialize immutable deck snapshots and
  track edit revisions, so a slow response cannot mark newer changes saved or race
  a duplicate first-save POST. Failed autosaves retry with capped backoff and expose
  the error. Back, My decks, and Sign out flush dirty edits before leaving; closing
  the page with unsaved work warns first.
- **Saved-deck retrieval (Sep 29).** `GET /api/decks/:id` returns the `deck` JSONB
  document, not the database row wrapper. The editor expects `slides` on that object;
  returning the wrapper made the rail, slide navigation, and content panel empty even
  though all slides were present in Supabase. Verified against the live six-slide deck.
- **Logo navigation (Sep 29).** In the app, the Storyloom logo returns signed-in
  users to `/studio` and flushes dirty editor state before showing the dashboard;
  signed-out users go to the landing page. The landing-page wordmark links to `/`.
- **Shared light/dark theme (Sep 29).** One header toggle and `storyloom-theme`
  preference work across the landing page and studio. Theme tokens cover app views,
  forms, editor chrome, status colors, and overlays; carousel skins remain unchanged.
  The studio topbar matches the landing theme and keeps the toggle visible on mobile.
- **Unified interface typography (Oct 1).** Manrope now runs through the landing page
  and studio UI; JetBrains Mono remains reserved for technical labels and code-like text.
- **Mobile landing ticker (Sep 30).** The strip under the nav scrolls as a seamless
  marquee below 700px; desktop remains static and reduced-motion preference disables it.
- **Mobile landing navigation (Sep 30).** Replaced the small dropdown with a full-screen,
  theme-aware drawer, divided section links, bottom-pinned actions, and close-on-navigation.
- **Mobile app first pass (Sep 30).** The signed-in header, dashboard cards, composer,
  and deck editor adapt to phone widths. The deck preview scales to fit and the slide
  rail/editor actions scroll inside their own regions; checked at 320px and 360px.
- **Homepage first pass (Oct 1).** Hero copy and primary action now describe the real
  input/output and lead to the studio; real starter decks and verified format specs
  use a responsive modular card layout. A short editor demo and remaining copy trim
  are still open.
- **Download — `/api/export`.** ZIP (`src/zip.js`, stored entries, no deps), PDF
  (`src/pdf.js`, one 1080×1350 page per slide) or a single PNG, off the same
  `render.js` path the preview uses. The old `/api/render` still writes to server
  disk on purpose — it is the proof that both renderers agree.
- **Server-side watermark enforcement.** Export re-adds the watermark for any
  non-pro deck whose toggle is off, and says so in `X-Storyloom-Watermark`. The
  client toggle is now a request, not the decision.
- **Brand library.** `supabase/migrations/0002_brands_plan.sql` + `src/brands.js` +
  `/api/brands` CRUD. A row is only ever *copied* onto `deck.brand` — the deck stays
  the single renderable source of truth, and a new deck inherits your default while
  a saved deck never has its footer rewritten behind you.
- **The AI tab.** `/api/rewrite` rewrites one slide: five presets (`REWRITE_PRESETS`
  lives next to the prompt in `generate.js`; `/api/meta` publishes labels only) plus
  a free-text steer. One credit, refunded when the model returns nothing usable, and
  the result lands as a single undo step.
- **Click-to-edit on the canvas.** The template renders `data-field` on every text
  block, so the editor reaches into the same-origin iframe and edits the field the
  click actually names. `contentEditable='plaintext-only'`, `beforeinput` enforcing
  the schema cap, Enter commits and Escape reverts. The affordance CSS is injected
  into the live document at runtime, so the file Puppeteer loads from disk is
  untouched — the preview is still the export.
- **Per-deck theme overrides.** The Style tab exposes background, text, accent, and
  font controls beyond the preset skins. Font stacks allow 120 characters. Changes
  update the shared preview/export template, enter undo/autosave history, and can be
  reset to the selected skin.
- **Editor layout polish (Oct 2).** Slide-rail controls have an opaque, bordered
  footer; tagline and subtitle inputs now use the same full-width field style as
  heading and body; the studio header aligns with the editor toolbar.
- **Editor refresh recovery (Oct 2).** The existing single-page studio records the
  active deck in the URL and a tab-scoped snapshot. Refresh restores the saved deck
  from the server or the in-progress draft locally, including the selected slide.
- **Explicit template entry (Oct 2).** In no-account mode, the studio now shows
  the AI-or-template starting choice instead of loading templates below the AI
  generator. The template gallery loads only after choosing that path.
- **Fixed: the account chrome was invisible the whole time.** `#dashLink`, the
  credits pill, the email and Sign out shipped with `hidden` in the markup and were
  revealed by `html[data-auth="in"] .acct { display: inline-flex }`. Bootstrap's
  reboot has `[hidden]{display:none!important}`, which no author rule can undo, so
  none of it ever appeared. The attribute is gone; `.acct { display: none }` is the
  pre-auth state.
- **Tests — 35 green, `node --test`.** `test/zip.test.js` (7) and `test/pdf.test.js`
  (6) read the bytes back with parsers that share no code with the writers: a ZIP
  navigator that follows each central-directory offset to its local header and
  requires the two copies to agree, `zlib.crc32` as an independent checksum oracle,
  and a from-scratch PNG encoder — all five row filters — so "lossless" is checked
  against known bytes rather than against pdf.js re-run. `test/export.test.js` (8)
  drives the route over HTTP: guards first (unknown format → `bad_input`, no deck →
  `bad_deck`, `/api/rewrite` with no slide → `bad_deck`), then a health check
  proving a refused export never launched Chrome, then real renders through the same
  template the preview uses — a 1080×1350 PNG, a 5-page PDF, a 5-entry ZIP. Those
  three are the only place the writers meet bytes Chrome actually produced. Nothing
  calls the model: `/api/rewrite` stops at the guard that runs before a credit is
  spent, because a test that costs quota is a test nobody runs twice.

### Admin-published templates (Sep 30)
- Admins can publish the current validated deck as a reusable starter template.
  `/api/templates` merges published Supabase decks into the gallery while keeping
  the three built-in defaults available as fallback. `0004_starter_templates.sql`
  protects published reads and admin writes with RLS. Custom style selection during
  generation is resolved server-side and carries the published style settings into
  the deck. The migration still needs to be run in the live Supabase project.

### Admin template and style catalogs (Oct 3)
- The dashboard now has separate Templates and Styles pages. Templates manage built-in
  starters and studio-made decks through draft, publish, edit, archive, and restore;
  template edits are kept as drafts until published. Styles manage reusable font,
  palette, base-skin, and layout settings with live shared-renderer previews, plus
  draft, publish, archive, restore, and built-in duplication. Publishing changes
  future uses only; existing decks retain their copied theme. `/api/admin/*` remains
  admin-gated, and layout/base-skin values are constrained by the deck schema.
- `0005_catalog_updated_at.sql` adds catalog draft snapshots and template timestamps.
  Admin pages and writes depend on running it after migrations 0001–0004.
- Focused tests cover schema repair, route auth, catalog filters/lifecycle, and mobile
  overflow. Browser coverage uses controlled API/auth stubs; live Supabase writes
  remain unverified.

### Reliability (Sep 5)
- **Generation latency guard (Sep 30).** Gemini defaults to a 20-second request
  timeout and one attempt per model before moving to the next fallback.
  `GEMINI_TIMEOUT_MS` and `GEMINI_ATTEMPTS` can override these defaults; fewer
  same-model retries trade some transient-error resilience for a shorter wait.
- **Model fallback chain.** `gemini-3.7-flash` answered a real generate with *"This
  model is currently experiencing high demand"* — a 503, after all three retries. The
  503 is per-model, not per-key: 3.5-flash served the same prompt in 1.3s while the
  primary was refusing. So `callGemini()` now wraps the old per-model retry loop
  (renamed `callOneModel`) and walks `[MODEL, ...GEMINI_FALLBACK_MODELS]`, default
  `gemini-3.5-flash,gemini-3.5-flash-lite`, both verified live to exist and honour
  JSON mode. It switches on `overloaded` (429/503) and on a timeout, and on *nothing
  else* — a blocked prompt or a bad request fails identically on a fresh model, so
  touring the chain would only make one clear error three times slower. The deck's
  notes name the substitute; a silent model swap is a support ticket later.
  `gemini-2.5-*` is not a candidate: a key issued today gets an instant 404,
  *"no longer available to new users"*, which would make the fallback look broken.
- **Errors stop speaking machine.** The compose panel printed `http_error:` at the
  user, verbatim, followed by Google's sentence. `ERROR_LABELS` in `app.js` maps all
  20 kinds to a human clause ("The model is busy", "Too little text on that page")
  with a generic fallback, and `overloaded` is its own kind — `503` — so the message
  can say what to do instead of whose queue you are in. The upstream wording is kept
  in `notes` for the log.
- **The refund is now visible.** `/api/generate` already refunded on failure, but
  said nothing and returned no balance, so the credits pill stayed one low until a
  reload — a failed generation that silently keeps a credit is indistinguishable from
  theft. It now pushes `credit refunded` into notes, returns the new balance, and the
  client re-renders the pill and says so under the error.

---

## Not built yet

### Week B — the remaining real work
Nothing. Everything on this list shipped on Sep 4, tests included; the entries are
above. The next open work is Week C.

### Week C — ship (Sep 14–20)
- [x] Skins #2 and #3 — already done in Week A, this line is free.
- [~] Staged loading copy, error and empty states. Staged copy shipped in Week A
      (`STAGES_TEXT`/`STAGES_URL`, plus the 45s and 90s lines) and the dashboard has
      both states; Sep 5 added a human label for every error kind. **Left:** no
      `aria-live`, `role="status"` or `role="alert"` exists anywhere in
      `index.html`, so none of that staged copy or any error is announced.
- [~] Mobile. First pass covers signed-in header, dashboard, composer, and deck editor
  at 320px/360px. Physical-device QA and remaining account/editor workflows remain.
- [~] Landing page: hero/CTA and responsive real-example cards refreshed. **Left:**
  capture a short real editor demo and review repeated access/FAQ copy.
- [ ] README + screenshots + 60-second demo video.
- [ ] Deploy, or a reliable local demo. Nothing exists yet — no Dockerfile, no host
      config. The constraint: full `puppeteer` (bundled Chrome) plus a persistent
      Express process, so serverless is out and a 512MB free tier is tight.
- [ ] Submit to Build Challenge #1 (closes Sept 30).

---

## Loose ends
- Apply `supabase/migrations/0005_catalog_updated_at.sql` after 0001–0004 in Supabase
  before the admin catalogs can read or write draft state. Local tests cover browser
  flows with API stubs and route auth, not live database writes.
- **What the 30 tests still do not cover:** a real model call. `test/fallback.test.js`
  stubs `globalThis.fetch` and overwrites the key with a throwaway string, so the
  chain logic is covered without quota, but nothing exercises a live generate — and
  nothing covers the credit/plan gating with Supabase actually configured, which is
  what `scripts/verify-supabase.mjs` checks live instead. So watermark *forcing* is
  asserted only in its degraded form: no accounts, no tiers, toggle honoured.
- Two gotchas from writing them. `test/export.test.js` must close the browser in
  `after()` (`await (await getBrowser())?.close()`) or `node --test` hangs — the
  server's one lazily-launched Chrome has no exported shutdown. And both failures
  the new suites produced were the *test* being wrong, not the code: an LCG's
  `x >>> 16` noise was compressible enough that zipSync correctly deflated it, and
  `/\/Type \/Page\b(?! )/` can never match a PDF where a space always follows.
  Cheap to fix, but budget for it — an independent reader has its own bugs.
- The UI is verified by a throwaway Puppeteer script (37 checks: boot, brand
  inheritance, the AI tab, undo/redo, click-to-edit, autosave, the brand library, a
  real PNG download) that fakes the signed-in half at the network edge — stubbed
  `/api/meta`, account routes and esm.sh module, everything else the real server. It
  lives in `%TEMP%` and is deliberately not committed. Two things cost an hour and
  are worth knowing next time: the stubbed esm.sh response needs
  `access-control-allow-origin` or the module never runs, and Puppeteer's `.click()`
  cannot resolve a point inside the CSS-transform-scaled preview iframe — dispatch a
  bubbling `mousedown` with `clientX/clientY` from the element's own rect instead.
- **Never put `hidden` on an element CSS is supposed to reveal** — Bootstrap's
  `[hidden]{display:none!important}` wins, silently. This cost the whole account
  chrome for two days.
- Task 10 of `docs/superpowers/plans/2026-09-03-auth-credits-decks.md` never closed:
  full suite green (5/5) ✅ and the `carousel.html` regression guard ✅. The
  degraded-preview snapshot + screenshot steps are still open, but no longer
  blocked — `npm run dev:degraded` gives them a server on 3210 regardless of who
  holds port 3000.
- Commit `fd4e9aa` has a wrong message (`modified:   public/index.html`) — it
  actually carries the reorder work and touches no `index.html`. No remote is
  configured, so rewording is safe whenever.
- The in-app Browser pane cannot attach on this install (a url-only launch config
  is rejected outright), so UI work is verified with a throwaway Puppeteer script
  against `dev:degraded`. Reading `iframe.contentDocument.body.innerText` per
  thumb is the check that actually catches a bad reorder — positional labels and
  `dataset.index` look identical before and after.

## Not in scope before Sept 20
File upload · AI imagery · stock search · brand-from-URL · posters · scheduling ·
MP4 · paid billing · multi-brand · rich text · OAuth · no-login demo ·
MCP/public API · 45 styles. See the scope firewall in the summary doc.
