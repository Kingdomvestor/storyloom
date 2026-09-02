# Storyloom — Project Summary

**Cohort:** Africoders
**Product:** Storyloom (creator brand: Kingdomvestor · @kingdomvestor)

**Naming:** Renamed from *Vestor* on **Sept 2, 2026**. One word, capital S: `Storyloom`. JS global is `window.STORYLOOM`; npm package is `storyloom`. Known risk, accepted deliberately: **Loom** is a well-known Atlassian-owned SaaS, so verify the X handle and run a trademark search before buying a domain. The working folder is still named `Content-to-Visual Generator (Vestor)` — renaming it would break the session path, so it stays for now.
**Why joined Africoders:** To be around other developers building in public, trade ideas on shipping faster, and stop reinventing wheels this community has likely already solved.
**Last updated:** Sept 2, 2026 — **renamed Vestor → Storyloom**; render engine built and verified; **Path A live** (text → Gemini → validated deck → PNG), **URL path live** (link → article → deck → PNG), **Path B seeded** (3 starter decks). 38 PNGs at 1080×1350. Week A Mon–Thu closed; Fri–Sun (web layer) is next.

---

## What Storyloom Is

A **SaaS web app** that turns **a line of text or a URL** into an **on-brand, editable carousel** — 5–10 slides at 1080×1350 for LinkedIn/Instagram — then exports PNG + PDF.

You sign up, create a **brand** once (colours, fonts, handle, tone), and every carousel after that comes out looking like yours. Credits meter the AI; manual carousels are unlimited.

Differentiator: vs **Canva** you don't design anything; vs **ChatGPT** you don't get raw text you then have to design.

**Full vision (built incrementally):** carousels → posters, short-form covers, thumbnails — from a URL, doc, or raw text. Inspired by [Supaslides.app](https://supaslides.app), [InstaCarousel.ai](https://instacarousel.ai), [Musemirror.app](https://musemirror.app).

---

## The Core Architecture Idea

**One HTML/CSS template does double duty.**

`templates/carousel.html` is loaded in an **iframe in the browser** (live preview + light edits) *and* by **Puppeteer on the server** (screenshot → PNG). Data enters via `window.CAROUSEL_DATA`; the page sets `document.documentElement.dataset.ready = "true"` once fonts are loaded and layout has settled — Puppeteer waits for that flag before shooting.

Consequences:

- **True WYSIWYG for free** — the preview *is* the export. No second renderer to keep in sync, so the bug class that kills these products doesn't exist.
- **No editor to build** — edits mutate the JSON, re-inject, re-render. Not a canvas engine.
- **Text stays crisp, exact, correctly spelled** — it's DOM text, not pixels from an image model.
- **Styles are CSS skins** — same layout engine, different stylesheet. Restyling is free and instant.

**Corollary (the decision that saves the sprint):** we never send a whole slide to an image model. AI writes words and structure only. Imagery, when it arrives, is a background layer *under* templated text.

---

## Two Entry Paths

Both land in the same editor, and both export through the same renderer.

| | **Path A — AI-first** | **Path B — template-first** |
|---|---|---|
| User intent | "I have a topic, write it for me" | "I know what to say, make it look good" |
| Input | text or URL | pick a template |
| LLM call | yes (Gemini) | **none** |
| Credits | −1 | **free, unlimited** |
| Seeded from | Gemini output | the skin's `defaults` block |

Path B is nearly free to build — it's "seed the JSON from template defaults instead of Gemini's output," same editor, same export — and it buys three things:

1. **A fallback.** Gemini down, quota hit, credits at zero → the app still works.
2. **A better free tier.** Manual carousels cost only Puppeteer CPU, so they're unlimited. Credits meter the one real variable cost: Gemini tokens.
3. **The users who don't want AI copy.** Plenty of people want the design, not the writing.

---

## Template Selection Is an Attribute, Not a Step

Restyling is free in this architecture (same JSON, different CSS skin), so the choice is never locked. `style_id` is settable in **three** places:

1. **Brand** — carries a default `style_id`, set once and reused.
2. **Compose** — a style picker that overrides the brand default, with live thumbnails.
3. **Editor** — a `Style` tab that swaps it instantly, as often as the user likes.

Reference tools each picked only one: Supaslides puts style on the brand (wizard step 2, ~45 art styles, live sample preview); InstaCarousel puts it in the editor (`Style` tab). Doing all three is strictly better UX and costs nothing.

---

## Locked Product Decisions

**Aug 25, 2026**
- **Output mode:** generate → **light edits** (edit text, recolour, reorder, add/remove slides, re-render). Not one-click-only, not a full Canva-style editor.
- **Launch format:** **carousels** first (4:5 · 1080×1350).
- **SaaS layer:** accounts + usage limits (Supabase Auth + free credits). Paid billing deferred.
- **Input:** text + URL first (URL auto-extract); file upload (.docx/.pdf) later.
- **Design approach:** templated text (HTML/CSS), **not** whole-slide image generation.

**Aug 31, 2026** (from the reference-tool teardown)
- **Brand is its own table**, not a field on the carousel — build once, reuse everywhere.
- **Two entry paths** (AI-first + template-first), both landing in the same editor.
- **`style_id` separate from `theme.palette`** — style is the layout skin, palette is the colours; independent axes.
- **`narrative_type`** added (listicle / how-to / story / myth-bust / case-study / manual) — the skeleton the LLM writes into.
- **`highlight_words`** instead of rich text — plain fields plus an array of substrings the template accents.
- **Autosave from day one**, plus an explicit Save button.
- **Watermark** is the free-tier lever, enforced server-side at export.
- **Auth: magic link only** — no Google/Apple OAuth for the sprint.

---

## Confirmed Stack

**Already comfortable with:** PHP, MySQL/PostgreSQL, Supabase, JavaScript, Bootstrap, Docker, n8n.
**New here (learning):** Puppeteer / headless rendering, LLM→JSON structuring, multi-slide layout logic.

| Layer | Tool | Why this one |
|---|---|---|
| Front-end | HTML + **Bootstrap 5** + vanilla JS | Already known; no build step, no framework tax |
| Server | **Node.js + Express** | Puppeteer is a Node library — same process, no bridge |
| Render | **Puppeteer** (headless Chrome) | Only reliable HTML→PNG at exact pixel dimensions |
| AI structuring | **Google Gemini API**, JSON-schema mode | Free tier; native structured output, no prose parsing |
| Validation | **Ajv** | Enforces the schema the LLM *claims* to follow. Trust nothing. |
| URL extraction | **@mozilla/readability** + jsdom | Firefox's own Reader Mode — strips nav/ads/footers |
| PDF | Puppeteer / **pdf-lib** | LinkedIn document posts need PDF |
| Auth / DB / Storage | **Supabase** (magic link + Postgres + Storage) | Already known; no password-reset flow to build |
| Container | **Docker** | Chrome's system deps: painful locally, trivial in a container |
| Later | n8n · Gemini image (Nano Banana) · Paystack | All deferred past Sept 20 |

**Cost through Sept 20: ₦0.** Gemini free tier, Supabase free tier, open source, local Docker.

---

## Repo Layout

Code lives at the **project root** (decided Aug 31).

```
schemas/carousel.schema.json    Ajv schema — the contract
src/validate.js                 Ajv + structural rules (hook first, cta last) + repair + lint
src/defaults.js                 per-style starter decks (Path B) + placeholder brand
src/gemini-schema.js            strict schema → Gemini-safe responseSchema (derived, never hand-kept)
src/generate.js                 Gemini → JSON + validate/retry/repair
src/extract.js                  URL → article text (Readability + SSRF guard)
src/render.js                   Puppeteer: deck JSON → PNG per slide
src/server.js                   Express API                               (Week A, Fri)
templates/carousel.html         THE template — browser preview + Puppeteer export
public/                         Bootstrap UI                              (Week A, Fri)
fixtures/                       hand-written decks for testing without an API key
prompts/v1.md, v2.md…           every prompt iteration, with notes on what changed
out/                            rendered PNGs (gitignored)
.env / .env.example             GEMINI_API_KEY — .env is gitignored, .env.example is not
```

---

## The Flow

```
SIGN IN ─────────────────────────────────────▶ Supabase Auth (magic link)

BRAND (once) ────────────────────────────────▶ POST /api/brand
  from a website → Readability: colours/logo/copy
  from scratch   → name · @handle · tone · palette · font
  + default style_id      ◀── style picker ①        → Supabase: brands
       │
       ├───────────────────────────┬─────────────────────────┐
       ▼                           ▼                         │
 PATH A · AI                 PATH B · TEMPLATE               │
  paste text / URL            pick a template                │
  slides: auto | 5–10         seed JSON from the skin's      │
  type: listicle | how-to |     `defaults` block             │
    story | myth-bust |       NO AI CALL · NO CREDIT         │
    case-study                                               │
  style ◀── picker ②                                         │
                                                             │
  POST /api/generate                                         │
   ├ check credits ──────────▶ Supabase: profiles            │
   ├ if URL: Readability ────▶ target page                   │
   ├ build prompt (+ brand tone, narrative_type)             │
   ├ Gemini JSON mode ──────▶ Gemini API                     │
   ├ Ajv validate → retry once → fallback (truncate)         │
   ├ −1 credit                                               │
   └ save ──────────────────▶ Supabase: carousels            │
       │                           │                         │
       └─────────────┬─────────────┘                         │
                     ▼                                       │
   ┌──── EDITOR (both paths land here) ─────────────────┐    │
   │  rail          canvas              panel           │    │
   │  slide thumbs  iframe →            Content         │    │
   │  ×N, drag to   carousel.html        tagline/title/ │    │
   │  reorder       CAROUSEL_DATA=json   subtitle/body/ │    │
   │  + Add Slide   click text to edit   bullets/       │    │
   │                                     highlight_words│    │
   │                                    Style ◀─────────┼────┘ picker ③
   │  every edit mutates JSON → re-inject               │      live swap
   │  AUTOSAVE (debounced) ──▶ PATCH /api/carousel/:id  │
   │  undo / redo = capped JSON snapshot stack          │
   └────────────────────┬───────────────────────────────┘
                        ▼
EXPORT ──────────────────────────────▶ POST /api/export/:id
  Puppeteer loads THE SAME carousel.html
  ├ inject JSON
  ├ apply watermark   ◀── from the user's PLAN, server-side only
  ├ wait for dataset.ready
  ├ screenshot ×N @ 1080×1350
  ├ stitch → PDF
  └ upload ─────────────────▶ Supabase Storage → signed URLs
```

Steps 4 and 5 load the **identical file**. That is the whole architecture.

---

## Data Model

```
profiles              brands                        carousels
────────────          ──────────────────────        ──────────────────────
id (= auth.uid)       id                            id
credits               user_id → profiles            user_id → profiles
plan                  name                          brand_id → brands
                      handle    "@kingdomvestor"    title
                      tone      free text           narrative_type
                      palette   preset | custom     style_id
                      style_id  default skin        source    ai | template
                      font_pair                     slides    jsonb  ◀── deck JSON
                      logo_url                      status    draft | exported
                                                    created_at / updated_at
```

Row-level security on all three (`user_id = auth.uid()`). **Credits decrement server-side only** — never trust the browser with a counter. Same rule for the watermark flag.

---

## Carousel JSON Schema

The **deck document**: what Gemini returns, what Ajv validates, what's stored in `carousels.slides`. `brand` is resolved at render time from `brand_id` and injected — not stored here.

```json
{
  "format": "carousel",
  "platform": "linkedin | instagram",
  "aspect_ratio": "4:5",
  "style_id": "signature-african | editorial-clean | mono-terminal",
  "narrative_type": "listicle | how-to | story | myth-bust | case-study | manual",
  "source": "ai | template",
  "theme": {
    "palette": "indigo-brass",
    "accent_hex": "optional #RRGGBB",
    "font_pair": "poppins-lato"
  },
  "title": "string, max 60 — deck name shown in the dashboard",
  "watermark": true,
  "slides": [
    {
      "type": "hook | body | cta",
      "tagline": "max 40, optional — eyebrow line",
      "heading": "max 60, required",
      "subtitle": "max 60, optional",
      "body": "max 180, optional",
      "bullets": ["max 90 each, up to 4"],
      "highlight_words": ["substrings in heading/body to accent"],
      "cta": { "label": "max 30" },
      "image": { "source": "none | upload", "ref": "storage key" },
      "page_label": "optional, e.g. 1/7"
    }
  ]
}
```

**Enforced by Ajv:** 5–10 slides · every length cap above · `additionalProperties: false` everywhere.
**Enforced in `src/validate.js`** (JSON Schema can't express "last item"): slide 1 is `hook`, final slide is `cta`.
**On failure:** retry Gemini once, then fall back to truncation/placeholders so the pipeline never crashes.

---

## Reference Systems Teardown

**Supaslides / InstaCarousel = LLM + HTML/CSS templates.** The LLM writes the words; design is templated; editing is live; what you see is what exports. This is the model Storyloom copies.

**Musemirror = image-generated** art-directed posters/covers, no in-app editing, a "critic pass" that regenerates weak frames. A different category — relevant only to later poster/cover formats.

**Confirmed from the Supaslides screenshots (Aug 31):**
- Sidebar IA: `Brands / Carousels / Ideas / Schedule` — brand is a first-class object.
- ~45 art styles in 7 groups (MINIMAL, ELEGANT, BOLD, PLAYFUL, MODERN, RETRO, SOCIAL & FILM), every thumbnail showing *identical* copy — proof that styles are CSS skins over the same data.
- Compose knobs: `Slides` (auto | number), `Type` (AI decides | Listicle | How-to | Story | Myth-bust | Case study), `Images` (auto).
- Brand-from-URL extraction, with honest progress copy: *"Finding the logo… Reading jazii.dev."*
- Free tier shown constantly: *"Carousels this month 0/3"* with a progress bar.
- Slide imagery comes from a **brand image library** (uploads), not AI generation.
- **Top feature request, 4 votes:** *"Possibility to save carousel — sometimes the program crashes and you have to edit it again."* Then: letter size, rich-text editing, remove non-text elements, custom page labels.

**Confirmed from the InstaCarousel editor screenshot (Aug 31):**
- The right panel is a **form** (`Tagline / Title / Subtitle / Body / Slide Image`), not a canvas editor — type in a field, JSON changes, slide re-renders. Their own slide 2 reads *"CLICK ANY TEXT TO EDIT ITS CONTENT"*, so both surfaces drive the same state.
- Tabs: `Content · Style · Brand · AI` — clean separation of scopes.
- **`Highlight Words`** is how *fully-customizable* renders green and italic: plain text field + an array of substrings the template wraps. Solves the rich-text request without a rich-text editor.
- Per-slide **"Rewrite with AI"**, metered: *"1 AI credit per rewrite. 0 remaining."*
- **Watermark toggle, locked** on free — visible but unusable. Good conversion UX.
- Manual `Save` with an *"Unsaved"* badge — the one thing to do differently, given Supaslides' users are begging for autosave.

---

## What We Steal vs. Skip

| Idea | Verdict |
|---|---|
| Templated text, LLM writes copy only | **In** — core |
| Brand as its own object | **In** — Week B |
| `highlight_words` instead of rich text | **In** — Week A schema, Week B UI |
| `tagline` / `subtitle` / `cta` slots | **In** — Week A |
| Editor tabs `Content · Style · Brand · AI` | **In** — Week B |
| Form panel + click-to-edit canvas | **In** — Week B |
| Watermark as free-tier lever | **In** — Week B, server-enforced |
| Autosave + explicit Save + undo/redo | **In** — Week B |
| Template-first path (no AI) | **In** — Week A |
| Honest staged loading copy | **In** — Week C |
| Stock image search | Out → Week 5 |
| Brand-from-URL extraction | Out → Week 5 |
| Per-slide "Rewrite with AI" | Out → Week C stretch |
| Scheduling · direct posting · MCP/API · animated MP4 | Out |
| 45 art styles | Out — we ship 3 |

---

## Monetization Model (falls out of the architecture)

| | Free | Paid (later, Paystack) |
|---|---|---|
| Manual carousels (Path B) | **unlimited** | unlimited |
| AI generations (Path A) | N credits / month | more credits |
| Watermark | on, locked | off |

Two levers, both cheap, neither cripples the product. Credits map exactly to the only real variable cost (Gemini tokens). Better than Supaslides' free tier, which caps *total* carousels at 3/month.

---

## The Plan — 3-week sprint to Sept 20, then expansion

Week 1 (Aug 25–31) went to research: four reference systems compared, whole-slide image generation ruled out, architecture locked. Worth it — but the sprint is now **3 weeks, not 4**, so the old Weeks 1 and 2 merge. Every week still ends in something demoable, so a slip never leaves nothing.

### Sprint

| Week · Dates | Objective | Core tasks | Evidence |
|---|---|---|---|
| **A** · Aug 31–Sep 6 | Render engine **+** web app | **Mon–Tue:** `carousel.schema.json` + `validate.js` + 3 fixtures (5-slide, 10-slide, deliberately ugly) → `carousel.html` (1080×1350, `CAROUSEL_DATA`, `dataset.ready`, autofit, `highlight_words`) → `render.js` → PNG set. **No API keys needed.** **Wed–Thu:** `generate.js` — Gemini JSON mode + Ajv + retry/fallback; `prompts/v1.md`. **Fri–Sun:** Express `/api/generate`, Bootstrap UI (compose box, slides/type/style chips), live iframe preview, URL input → Readability, Path B template gallery | Browser: paste text *or* URL *or* pick a template → live preview → PNGs on disk |
| **B** · Sep 7–13 | Edit · export · accounts | Editor: slide rail (reorder, add/remove), form panel (`Content · Style · Brand · AI` tabs), click-to-edit canvas, `highlight_words` UI, live style swap; **autosave** + Save + undo/redo; `/api/export` → PNG set + PDF; Supabase magic-link auth, `brands` table + brand builder, credits with server-side decrement and block at 0; watermark on free | Logged-in user creates a brand, generates, edits, exports — credit-limited, watermarked on free |
| **C** · Sep 14–20 🏁 | Skins · landing · ship | Skins #2 and #3 (proves the style axis); staged loading copy, error/empty states; mobile; landing = hero + demo GIF + sign-in (**not** a 5-section marketing site); README + screenshots + 60-sec demo; deploy or reliable local demo; **submit to Build Challenge #1** | Live Storyloom + submission in, 10 days before the Sept 30 deadline |

**If Week C runs long, the landing page is what gets cut** — decided now so it isn't debated later. The challenge scores problem/usefulness 30% + execution 25% + technical 20% = **75% on the product**; UX 15%, originality 10%.

### Expansion — one bit at a time

| Week · Dates | Objective |
|---|---|
| **5** · Sep 21–27 | 3–5 real testers; fix top friction; **brand image library** (uploads composited behind text — ₦0) |
| **6** · Sep 28–Oct 4 | Second format: 1:1 square or 9:16 story · Build Challenge #1 closes **Sept 30** |
| **7** · Oct 5–11 | AI imagery layer — Gemini image ("Nano Banana") backgrounds under templated text |
| **8** · Oct 12–18 | n8n orchestration: generate → render → store; optional scheduling hook |
| **9** · Oct 19–25 | Paystack billing wired to the credit model, test mode |
| **10** · Oct 26–Nov 1 | Wider testing, polish, public launch post + demo video |

---

## Scope Firewall — do not build before Sept 20

File upload (.docx/.pdf) · AI-generated imagery · stock image search · brand-from-URL extraction · posters / covers / thumbnails · scheduling or auto-posting · animated MP4 carousels · paid billing · multi-brand workspaces · rich-text formatting inside a field · Google/Apple OAuth · no-login demo mode · MCP server or public API · 45 art styles.

Every one of these exists in the reference tools, and every one is a week you don't have. **Three skins, one format, one input pair, one auth method.**

---

## Agent Training Approach (the AI structuring step)

- Strict system prompt: output **only** JSON matching the schema, no commentary.
- Explicit constraints: length caps per field, min/max slide count, `narrative_type` skeleton, fallback for thin input, rejection for invalid input.
- Ask the model for `highlight_words` too — emphasis arrives for free.
- Few-shot examples: 3–5 real input/output pairs, including one messy/short edge case.
- Validate after output: Ajv + structural rules, retry once on failure, then truncate/placeholder.
- Systematic testing: 10–15 varied inputs (long article, short paragraph, pre-bulleted list, messy input), pass/fail tracked.
- Prompt versioning: keep every iteration in `prompts/` with notes on what changed and why.

---

## Working Preferences (how to help on this project)

- Tie answers to the **current sprint week**; support "week N check-in" prompts (what was built, what blocked, ready to move on).
- Prefer **free / open-source** tools.
- Explain new tools (e.g. Puppeteer) **from first principles** — assume general web-dev knowledge, not tool-specific familiarity.
- Give **runnable code for the actual stack** (Node/JS · Supabase · Bootstrap; n8n later) — not pseudocode.
- **Push back on scope creep** given the Sept 20 ship target.

---

## Africoders Context

- **Build Challenge #1** — ₦400k declared pool, submit by **Sept 30, 2026**. Storyloom is the submission. Judged: problem/usefulness 30%, execution 25%, technical 20%, UX 15%, originality 10%.
- **Poster of the Week** — ₦5k weekly, staff pick. "Poster" = the member who **posts** the most genuinely useful **written** content, not a poster image. Win it by posting honest build-in-public progress.
- **Introduce Yourself** — done (Week 1, closed Aug 28).

Prizes are declared out of band — the real value is recognition, portfolio, and discovery.

---

## Week A, Mon–Tue — DONE (Sept 1)

All five pieces built and verified with zero API keys:

1. ✅ `schemas/carousel.schema.json` — the locked contract.
2. ✅ `src/validate.js` — Ajv (draft-2020 build) + structural rules + `repairDeck`.
3. ✅ `fixtures/` — `sample-5`, `sample-10`, `sample-ugly` (layout stress), `sample-invalid` (repair test).
4. ✅ `templates/carousel.html` — 1080×1350, `CAROUSEL_DATA`, `dataset.ready`, heading autofit, `highlight_words`, three skin token sets on one layout.
5. ✅ `src/render.js` — Puppeteer → `out/<fixture>/slide-01.png` … `slide-NN.png`.

**Measured:** 20 PNGs, all exactly 1080×1350, 0 wrong size. ~1s/slide (10-slide deck in 9.7s). Three fixtures validate; the deliberately broken one repairs to valid.

### Defects found and fixed on Sept 1

| Defect | Root cause | Fix |
|---|---|---|
| `repairDeck()` could never rescue an unknown top-level key | Whitelisted slide fields but spread the deck object raw, so a stray key survived `additionalProperties: false` | Rebuild the deck from `schema.properties` keys; same for `theme`/`brand`, plus bare-hex recovery |
| `sample-ugly.json` was accidentally *invalid* (66-char title, 63-char heading) | It's a layout test, so it must validate | Shortened both to at-cap |
| ~40% dead space at the bottom of every slide | `.spacer` after content pinned everything to the top, and autofit only ever shrank from a 96px ceiling | Auto margins on the stack's outer children (centres when there's slack, collapses to 0 when full — unlike `justify-content:center`, which clips the top on overflow); CAP raised to 132px |
| Long words broke mid-word instead of shrinking | `overflow-wrap: anywhere` fired before autofit had a chance; autofit only tested height | Added a horizontal pass: measure `scrollWidth` under `overflow-wrap: normal`, shrink until the longest word fits, then restore `anywhere` as a floor-level net |
| Brandless decks rendered a phantom ~80px footer | `footerHTML` always emitted a `.footrow`, even when empty | Return `""` when there's no name, handle, or page label |
| Autofit was 3× slower after the above (1.7s/slide) | Linear 2px steps forced ~50 reflows per constraint | Binary search over `[FLOOR, CAP]` — ~7 reflows per constraint. Matters because the editor re-runs this per keystroke |

### Still open (deliberately)

- **`autofitBody()` is still a linear loop.** Only runs on overflowing slides, so it's the rare path. Revisit if the editor feels sluggish.
- ~~**Per-skin `defaults` blocks**~~ — done Sept 2 as `src/defaults.js`. The placeholder-brand concern was real: `sample-ugly` has no `brand` and rendered footer-less, so every starter deck now ships one.
- **A pathological deck can still under-fill.** `sample-ugly` slide 2 sits centred in a mostly-empty card because a 28-char unbreakable word caps the type size. Inherent to the input; a real deck has a brand and a footer.

---

## Week A, Wed–Thu — DONE (Sept 2)

Path A works end to end. Four pieces, all verified against the live API:

1. ✅ **`prompts/v1.md`** — system instruction, placeholder-templated (`{{FIELD_BUDGETS}}`, `{{SLIDE_COUNT}}`, `{{NARRATIVE_TYPE}}`, `{{PLATFORM}}`). Rules that matter: *words only, never describe imagery, never say "swipe"*; *never invent a statistic, name or quote the source doesn't contain*; the six narrative skeletons; *aim for ~80% of each cap* (asking for the cap produces text that hits the cap and gets clamped).
2. ✅ **`src/gemini-schema.js`** — derives the Gemini-safe `responseSchema` from the strict draft-2020-12 schema at load. Inlines `$ref`, converts `const` → single-value `enum`, drops keys Gemini rejects. Caps can never drift from what Ajv enforces because there is only one copy of them.
3. ✅ **`src/generate.js`** — Gemini call → Ajv → **retry once with Ajv's own error strings fed back** → `repairDeck()` → `degraded: true`. Never throws. Honours `Retry-After`; retries 408/429/5xx; reports `MAX_TOKENS` rather than retrying it (an identical request truncates identically).
4. ✅ **`src/extract.js`** — URL → article text, with the SSRF guard the endpoint requires.
5. ✅ **`src/defaults.js`** — three starter decks (one per skin), each carrying a placeholder brand so a template-first deck never opens with an empty footer.

**The model authors two fields.** `title` and `slides` — nothing else. `format`, `platform`, `style_id`, `source`, `watermark`, `brand` are the app's business. `image` is withheld from the schema entirely, so there is nowhere to put imagery even if it wanted to; `page_label` is arithmetic, not writing.

**Measured:**

| | Result |
|---|---|
| Decks generated | 4 (listicle 7, how-to 6, myth-bust 5, from-URL 6) — all valid on the **first** pass, 0 repairs |
| Generation cost | ~10–16s, ~2.7k–4.5k tokens per deck |
| PNGs on disk | **38**, all exactly 1080×1350, 0 wrong size, 0 suspiciously small |
| URL path | Wikipedia article → 11,952 chars clean prose → 6 slides → 6 PNGs |
| SSRF | **20/20** hostile URLs refused; public hosts still reachable (guard is not over-broad) |
| Starter decks | 3/3 validate, 0 lint warnings, render in 4.8–5.8s |
| Dependencies added | **0** — native `fetch`, native `process.loadEnvFile()`, no SDK, no dotenv |

### Defects found and fixed on Sept 2

| Defect | Root cause | Fix |
|---|---|---|
| A word rendered two-tone — "**Explicit**ly" with a green stem and a white suffix | The template highlighted the literal substring with no word boundaries | Extend every match outward to whole-word edges in `templates/carousel.html`. Fixed in the template, not the prompt: no wording rule prevents it, and a user typing their own highlight word would hit the same bug |
| **The lint written to catch exactly that missed it** | `deckWarnings()` used `lower.indexOf(needle)` — one lookup. The first occurrence of "explicit" was the clean standalone one in the heading, one line above the broken one | Scan **every** occurrence. It now also flags a dud in `sample-ugly.json` that nothing had ever checked |
| SSRF bypass in my own guard: `http://[::ffff:10.0.0.1]/` got through | The URL parser normalises it to `[::ffff:a00:1]`, and the guard matched on the dotted spelling | Replaced string matching with `expandIPv6()` + group checks covering IPv4-mapped, IPv4-compatible, NAT64 and 6to4 |
| A Wikipedia infobox arrived as `"Jollof riceAlternative namesBenachin, riz au gras"` | `article.textContent` concatenates block elements with no separator — this was the first thing Gemini would read | `textFromContent()`: strip tables/figures/`<sup>` citations, insert real `\n\n` after block elements, then take the whole tree. Chosen over selecting block elements, which drops text belonging to a skipped ancestor |
| A 503 "high demand" killed a run outright | Backoff was 500ms/1s — far too impatient for a demand spike — and the CLI never printed the status code that would have identified it in one second | `retryDelay()` honours `Retry-After`, else 1s/3s. Status code added to the FAIL line |
| The prompt told the model highlight matching was case-*sensitive* | It isn't — `templates/carousel.html:190` uses the `gi` flags | Rewrote the section to describe what the code does, and to warn about the no-word-boundary hazard instead of inventing a rule about case |

### What the probes changed

I predicted Gemini's `responseSchema` support for `maxLength` would be patchy and planned a workaround. Six live probes said otherwise: `maxLength` and `pattern` are both accepted **and enforced** (asked for ≤20 chars, got 19). Only three things hard-400: `additionalProperties`, `$ref`/`$defs`, and `const`. The deriver is three transformations instead of the six I'd sketched, and the workaround was never built.

### Still open (deliberately)

- **`text-wrap: balance` on `.heading`** — a one-line CSS change to stop orphaned words. Visible as a stranded "an" in `out/gen-from-url/slide-01.png`. Deferred as scope drift, not forgotten.
- **`autofitBody()` is still a linear loop** — only runs on overflowing slides. Revisit if the editor feels sluggish.
- **The key was briefly in `.env.example`**, which `.gitignore` deliberately un-ignores. Moved to `.env` and verified excluded via `git add -An` plus a content grep; nothing was ever committed. **Rotating it at aistudio.google.com/apikey is still worth 30 free seconds** — it also passed through a chat transcript, and build-in-public screenshots are being posted.

---

## Week A, Fri–Sun — DONE (Sept 2)

The web layer shipped without Bootstrap — plain HTML/CSS/JS, zero new dependencies. **Both entry paths and the whole pipeline are now verifiable in a browser:**

- **Compose screen** — paste text or URL, slide count, narrative shape, platform, three skin cards (token swatches, not screenshots), live char counter, `Use a sample`, `Preview text`, staged working copy with an elapsed-seconds clock.
- **Path A (AI)** — filled form → Generate → editor with an `AI` badge and the deck. Verified with the sample: 5 slides, `valid`, "How to finish your side project". Full-screen screenshot + `out/web-001-signature-african/` PNGs, exported from the browser; slide-01 PNG is pixel-identical to the on-screen preview (same line breaks, same gold italics, same body wrap).
- **Path B (template)** — gallery of 3 starter decks, each a live iframe running the shared template. Click → editor, `TEMPLATE` badge.
- **Editor** — rail of 5 live thumbs, 1080×1350 stage fed by the same iframe, Content/Style/Brand tabs. Content tab builds inputs with `maxLength` from `/api/meta`'s caps so the UI cannot author an invalid deck; bullet and highlight-tag rows get add/remove; CTA field appears only on the last slide (slot semantics from the schema).
- **Skin swap** — verified: Mono Terminal flips the stage *and all five rail thumbs* in ~1.4s, no model call. The `data-style` attribute is the one knob.
- **Live validation** — `/api/validate` with debounce; warnings are clickable and jump to `slides/N`; the pill reads `valid` or lists what's wrong.
- **A11y pass** — the four single-select rows (source tabs, slide count, skin, panel tabs) now move `aria-selected`/`aria-pressed` in step with `.on`, via one `selectOne()` helper; tab rows carry `role=tablist`/`tabpanel` pairs.

### Defects found and fixed in this section

| Defect | Root cause | Fix |
|---|---|---|
| **`.env` was loaded too late** — `GEMINI_MODEL` change had no effect; the CLI still talked to the degraded `gemini-3.7-flash` | `process.loadEnvFile()` ran lazily inside `apiKey()` during the first call. `MODEL`/`TEMPERATURE`/`TIMEOUT_MS` are evaluated at module load — long before that. The key worked because it's read at call time, which masked everything | Hoisted the loader to module top, guarded on `!process.env.GEMINI_API_KEY`; `apiKey()` is now a one-line read |
| CLI silently coerced bad flags | `generateDeck()` falls back to defaults rather than 400ing — right on the HTTP path, wrong at a terminal; `--type how_to` (underscore) quietly produced a **listicle** | `pick()` helper in the CLI: unknown enums and non-numeric `--slides` exit 2 with the valid list |
| Gallery previews stuck at stale width (black gap) | `scaleFrame()` wrote an explicit px width, so the ResizeObserver read back its own value — a fixed point it could never grow out of | `{ setWidth = true }` option; gallery uses `setWidth: false` and measures layout-derived width |
| Stage overflowed the viewport | `.workspace` grid row was `auto` (content-sized) while `fitStage()` sized content from the row — a circularity that settled wherever first paint landed | `grid-template-rows: minmax(0, 1fr)` + `min-height: 0; overflow: hidden` on `.stage`; bounded `68vh` in the ≤940px branch; `fitStage()` measures nav + note |
| Worst-case wait was ~180s and the copy dead-ended | `generate.js` retries 3× at `GEMINI_TIMEOUT_MS`; the staged lines stopped at "Still going…" with no clock | One ticker owns clock + message: elapsed seconds after 3s, honest copy past 45s ("Slower than usual…"), past 90s ("Retrying — the model timed out at least once") |

### What was verified live, not just in code

- `gemini-3.7-flash` was **degraded upstream** — it times out even on "Say OK." (45s), while `gemini-3.5-flash` answers in ~7s and `gemini-2.5-flash` in ~1s. Detected by elimination (health → CLI → keyless probe → model list → per-model probe), not guesswork. The app's retry/timeout/envelope behaviour held exactly as designed. `.env` now sets `GEMINI_MODEL=gemini-3.5-flash`; the docs note the degradation.
- Path A generate from the browser: ~7s, deck valid on first pass. CLI: 17.4s / 4088 tokens / 1 pass.
- Restyle is truly free: skin swap re-renders everything client-side from `templates/carousel.html`, the same file Puppeteer opens from disk. **The preview iframe and the exporter can never drift — that is the whole architecture.**

### Still open (deliberately)

Same list as before — `text-wrap: balance`, `autofitBody()` linearity, key rotation advice. No new deferrals were created except: the `aria-pressed`/`.on` pattern is now one helper, and `role=radio` was deliberately *not* used (it obliges arrow-key navigation; a half-implemented radiogroup reads worse than labelled toggles).

### Note on the user's open question

The UI-or-not question was the point of this section: **the frontend was built in plain HTML/CSS/JS without any UI agent or plugin.** It is fully working; whether to add one is now a judgment about speed, not necessity. Nothing here requires one.

---

## Next Step

**Week B — the editing experience.** The editor is read-only today; the work is making it feel like a tool you can drive:

1. **Reorder slides** — drag the rail (or up/down move buttons as the no-drag fallback).
2. **Add / remove slides** — insert a slide of any slot type anywhere; delete from the rail. Must keep at least 1, at most `meta.slides.max`.
3. **Undo / redo** — the deck is a single JSON value in `state`; a small command stack (or just two snapshots stacks) makes this cheap and makes the destructive buttons safe to ship.
4. **Autosave to IndexedDB** — a draft keyed by `deck_id`; a "Draft restored" toast on boot. Local-first, with a rewrite that never fails loudly. This is the one feature users will notice missing and the cheapest one to get right.
5. **Download / export surface** — the PNGs already render; what's missing is the button and the zip. `pdf` and `mp4` stay behind the `pdf: false` flag.
6. **Watermark enforcement** — the template already renders it; the switch is inert. Enforce server-side at render time so a hand-edited deck can't dodge it. Free tier = watermark; paid = none. This is the first real monetization wiring.

**Not this week:** auth, credits, Supabase, landing page — all Week B+ in the plan. Also not this week: a UI framework. The plain-CSS answer stayed fast to build and the deliverable is the same screens.

**Evidence that closes Week B:** reorder two slides, add a slide, remove one, undo back to the start, watch the PNGs change, then do all of it with the network tab showing zero /api calls (except render).

---







