# Storyloom

Text or a URL in → an editable 5–10 slide carousel out, at 1080×1350.
Africoders Build Challenge #1. Ship target **Sept 20, 2026**. Budget so far: ₦0.

## Architecture — the one thing to not break

`templates/carousel.html` has **two consumers**: the browser preview iframe (served
read-only at `/templates/carousel.html`) and Puppeteer, loading the same file from
disk. Serving rather than copying is what makes the preview *be* the export. Never
duplicate that file.

Its only interface is `window.STORYLOOM`: `setDeck(deck) → slideCount`,
`renderSlide(i)`, `slideCount()`, `get index`. Plus `<html data-style>` for the skin
and `documentElement.dataset.ready === "true"` as the screenshot-safe signal.

Other invariants:
- `schemas/carousel.schema.json` is the single source of truth. `/api/meta` reads
  enums, slide bounds and char caps off it; the UI sets `input.maxLength` from the
  cap so it *cannot* author an invalid deck.
- Validation lives only in `/api/validate` (one Ajv instance + lint). The browser
  does a trivial substring check for dud highlight tags and nothing more.
- Every response is `{ ok: true, ... }` or `{ ok: false, kind, message }`;
  `STATUS_BY_KIND` maps kind → HTTP status.
- One persistent Puppeteer browser, lazily launched, relaunched if
  `browser.connected` goes false. Renders serialized through `queueRender()`.

## Scope line

**Week A (shipped):** compose → generate → edit → preview → render PNGs.
**Shipped since:** auth, credits, Supabase deck store, explicit save, template
gallery, drag-to-reorder, add/remove slides, undo/redo, autosave, download
(ZIP/PDF/PNG), server-side watermark enforcement, the brand library, the AI
rewrite tab, click-to-edit on the canvas.
**Not built yet:** Week C — loading/error/empty states, mobile, landing page,
README + demo video, deploy.

Do not build a not-built-yet item without being asked.

## Environment

- Node 24.14.0 / npm 11.19.0, Windows 11, Git Bash.
- **Every Bash call needs:** `export PATH="/usr/bin:/c/Program Files/Git/usr/bin:$PATH"`
- Git Bash maps `/tmp` → `C:\tmp`, but Node writes to the Windows temp dir.
  Use `process.env.TEMP`, never `/tmp`.
- Dev server: `.claude/launch.json` → name `storyloom`, `npm start`, port 3000.
- Project-local Claude settings belong in `.claude/settings.json`. To make Claude
  use this folder for its config, set `CLAUDE_CONFIG_DIR` in the shell or user
  environment before launching Claude Code; do not put that variable inside the
  settings file itself.

## Secrets

The Gemini API key must **never** appear in the conversation, in a screenshot, or in
`.env.example`. It lives only in `.env` (gitignored). Note `.gitignore` contains
`!.env.example` — that file is committable, so it stays empty-valued.
Touch the key only inside `node -e` with `process.loadEnvFile()`, printing status
only. Append to `.env` via heredoc; never read it into context.
Vestor posts build-in-public screenshots — assume anything on screen is public.

## Working rules (these exist to keep cost down)

Cost is quadratic in session length: everything read stays in context and is
re-sent on every turn after.

- **Grep, don't Read.** `public/app.js` is ~34KB (~9k tokens). Read whole files only
  on first contact; after that use `Grep -n -C 5` or `Read` with offset/limit.
- **Verify with text, not pixels.** `preview_snapshot` for content and structure,
  `preview_inspect` for CSS values (more accurate than a screenshot anyway).
  Screenshot once at the end to *show* Vestor the result — never to check work.
- **Never guess DOM selectors.** Snapshot once, then work from it.
- **Batch independent tool calls** into a single block.
- `/clear` when a unit of work closes rather than running one long session.

## Convention

`MEMORY.md` is the feature ledger — what is shipped, what is left, what is out of
scope. Update it in the same commit as the work: move the item, date the header,
and add loose ends as you find them. If it disagrees with the code, the code wins
and the ledger is the bug.

When real work closes, append an X draft to `posts.md` — Vestor builds in public
as **@kingdomvestor**. Prefer the honest debugging story over the feature announcement.
