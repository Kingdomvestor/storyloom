# Storyloom — build-in-public drafts

Running list of ready-to-post X drafts, appended as work closes. Newest at the bottom.

**How this works**
- Claude appends an entry when something real ships or a real bug gets fixed — not for every edit.
- Every entry is self-contained: you never need to remember the context to post it.
- Pick one whenever you feel like posting. Change `Status: draft` → `Status: posted`.
- No schedule, no queue, no obligation. If you ignore it for three weeks it cost you nothing.

**Conventions**
- All drafts are under 280 characters so they post anywhere without editing.
- "Plain English reply" is optional — post it as a reply for non-technical followers.
- Image paths are relative to the project root. Regenerate with `npm run render:all` if `out/` is stale.
- Account: @kingdomvestor · Product: Storyloom (renamed from Vestor, Sept 2 2026) · Context: Africoders Build Challenge #1, shipping Sept 20 2026.

---

## 2026-09-01 — WYSIWYG export
Status: draft

> Storyloom exports carousels as PNGs. Preview and export must match exactly.
>
> Issue: screenshots fired before fonts loaded, so text measured wrong.
>
> Fix: the template flips data-ready=true only after fonts resolve. Puppeteer waits for that flag.
>
> 20/20 pixel-perfect.

**Plain English reply:** What you see on screen is exactly what downloads — not something slightly different. Fonts load a beat slower than everything else, so my exporter was taking the photo before the text finished settling. Now it waits for the signal.

**Images:** `out/sample-5/slide-01.png`, `out/sample-5/slide-05.png`

---

## 2026-09-01 — The repair function
Status: draft

> Built a repair function so a bad AI response never crashes Storyloom.
>
> Issue: fed it a broken deck on purpose. Still invalid.
>
> I cleaned every slide field but spread the top-level object raw. One stray key and repair could never work.
>
> Fix: rebuild from the schema's own keys.

**Plain English reply:** AI sometimes returns junk. Rather than showing you an error, Storyloom quietly cleans the junk and hands you a usable carousel. I'd built that safety net wrong — it looked fine in the code and caught nothing.

**Images:** none needed. A screenshot of the `repairDeck()` diff works if you want one.

---

## 2026-09-01 — The hostile test deck
Status: draft

> Every test deck I wrote passed and looked great. I didn't trust that.
>
> So I built one designed to be hostile: 60-char headings, a 50-char unbroken word, every field maxed at once.
>
> It found 6 bugs. One was my own fix making renders 3x slower.
>
> All fixed. 20/20 clean.

**Plain English reply:** I wrote a deliberately awful carousel — longest possible words, every slot stuffed to the limit — to find what breaks before a real user does. It found six problems, including one I'd just introduced myself.

**Images:** `out/sample-ugly/slide-02.png` (the 28-char unbreakable word, handled), `out/sample-ugly/slide-03.png` (every field maxed, nothing clipped)

**Note:** this is the strongest of the five. Post it when people are already paying attention, not first.

---

## 2026-09-01 — Three styles, one template
Status: draft

> Storyloom ships 3 visual styles. I didn't want 3 templates to maintain.
>
> Issue: mono-terminal needed its own rules — a > prefix, wider text measure, no italics.
>
> Fix: skins are CSS variables switched by one attribute, with per-skin overrides.
>
> Restyling is free.

**Plain English reply:** Switch your carousel between three completely different looks with one click, instantly, without regenerating anything. Behind the scenes it's one design file, not three — so a fix to one is a fix to all.

**Images:** post all three side by side, or it isn't convincing —
`out/sample-5/slide-03.png` (signature-african), `out/sample-ugly/slide-03.png` (editorial-clean), `out/sample-10/slide-01.png` (mono-terminal)

---

## 2026-09-01 — The import path
Status: draft

> Spent longer than I'd like on:
> "no schema with key or ref draft/2020-12"
>
> Ajv's default export is the draft-07 build. My schema was 2020-12.
>
> Fix: import Ajv from 'ajv/dist/2020.js'
>
> One import path.

**Plain English reply:** There's a rulebook that checks the AI's output is shaped correctly before anything gets drawn. I was accidentally loading an older edition of the rulebook, so it refused to read my rules at all.

**Images:** none.

**Note:** the real error message contains the full `https://json-schema.org/draft/2020-12/schema` URL. It's trimmed here on purpose — X would linkify it mid-sentence and the post would look broken.

---

## 2026-09-02 — The rename
Status: draft

> Renamed my product today, 18 days before launch.
>
> Vestor → Storyloom.
>
> 26 refs, 9 files, 30 minutes.
>
> Nearly shipped a bug: my handle is @kingdomvestor. A blind find-and-replace would've made it @kingdomStoryloom.
>
> Rename early. It only gets pricier.

**Plain English reply:** I changed the name of the thing I'm building. Doing it now cost half an hour. Doing it after launch would have meant a domain, an app store listing, and every link anyone had ever shared.

**Images:** `out/sample-5/slide-01.png` — the new watermark and brand footer, rendered.

**Note:** the handle detail is the part people will react to. Everyone who has ever run a find-and-replace has felt that specific fear.

---

## 2026-09-02 — The two-tone word
Status: draft

> Storyloom highlights your key words in the accent colour.
>
> Issue: it rendered "Explicit" in green and left "ly" white. Looked like a typo.
>
> My linter missed it. It only checked the first match — and the first one was clean.
>
> Fix: extend every match to the whole word.

**Plain English reply:** You mark which words should stand out in colour. The tool was colouring part of a word and leaving the rest plain, so "Explicitly" came out looking misspelled. I'd even written a checker for exactly this — it just looked at the first place the word appeared and stopped.

**Images:** `out/gen-howto/slide-03.png` — the fixed version. For a proper before/after you'd have to temporarily undo the template change and re-render; the broken PNG was overwritten.

**Note:** the "my own linter missed it" beat is the post. Everyone has written a test that passed for the wrong reason.

---

## 2026-09-02 — The workaround I nearly built
Status: draft

> I assumed Gemini's structured output would reject my character limits, so I planned a workaround.
>
> Then spent 30 seconds actually testing it.
>
> maxLength: accepted. pattern: accepted. Only 3 things broke.
>
> I nearly built a fix for a problem I invented.

**Plain English reply:** I was sure one part of Google's API wouldn't accept my rules, and I'd already designed a way around it. A two-minute experiment showed it accepted almost everything. The workaround would have been pure wasted work — and extra code to maintain forever.

**Images:** none. A screenshot of the probe output — six lines, ACCEPTED / REJECTED — is the whole story if you want one.

---

## 2026-09-02 — 19 of 20
Status: draft

> Storyloom turns a URL into a carousel. So it fetches URLs strangers give it.
>
> Which means it has to refuse its own private network, or it becomes a door into it.
>
> Wrote the blocklist. Tested it with 20 hostile URLs.
>
> 19 blocked. My own guard leaked one.

**Plain English reply:** If a tool will fetch any web address you hand it, someone will hand it an address inside the server itself — where passwords and keys live. So it needs a list of addresses it refuses. I wrote mine, then attacked it. It let one through.

**Images:** none. The pass/fail list of the 20 URLs is the image if you want one.

**Note:** the leak was `::ffff:10.0.0.1` — an internal address written in IPv6. The URL parser silently rewrote it to `::ffff:a00:1` and my check was looking for the other spelling. Good detail for a reply if anyone asks.

---


## Suggested order

Feature → visual payoff → relatable → the debugging stories. The last group is the strongest, which is why it goes after people are already watching, not first.

1. **WYSIWYG export** — leads with what the product does.
2. **Three styles, one template** — the visual payoff. Post all three images together or it isn't convincing.
3. **The rename** — relatable, low-stakes, wide appeal.
4. **The two-tone word** — the best story in the file. My own linter had the same blind spot as the bug.
5. **The hostile test deck** — deliberately breaking your own work.
6. **19 of 20** — security, and a self-inflicted miss.
7. **The workaround I nearly built** — short, quotable.
8. **The repair function** / **The import path** — filler. Post when you want to say something and nothing bigger has closed.

---

## Ideas not yet drafted

Parked here so they don't get lost. Not posts yet — just work worth writing up when it closes.

- **Two entry paths.** AI-first costs a credit; template-first is free and unlimited. Both land in the same editor. **Path B now works** (3 starter decks, validated and rendered) — post-ready once the gallery is on screen and there's a screenshot to show.
- **Never send a slide to an image model.** The AI writes words and structure only; imagery is a background layer under templated text. This is a genuinely contrarian take and worth its own post. Half-built already: `prompts/v1.md` forbids describing imagery, and the schema withholds the `image` field from the model entirely, so it has nowhere to put any.
- **Credits map exactly to the one variable cost.** Free tier is unlimited manual + watermark; paid removes the watermark and adds credits. Post this when pricing is real, not before.
- **The flaky triple render.** Three back-to-back Puppeteer launches failed at once, then never again. If reusing one browser instance in the Express server fixes it for good, that's a post. If it stays unexplained, it isn't.
## 2026-09-02 — The web layer ships
Status: draft

> Storyloom's UI is live. Paste an idea, pick a skin, get an editable carousel.
>
> The preview and the export run the same template file — the PNGs come from the same pixels you see.
>
> Every limit the AI must obey (5–10 slides, 180-char body…) is enforced by the form itself, so it's impossible to author an invalid one.
>
> Oh, and the whole thing — 3 AI skins, editor, live validation, PNG export — is plain HTML/CSS/JS. No framework. It costs nothing.

**Plain English reply:** You can now actually use it: paste a mess of ideas, pick a look, and it writes the carousel. What you see is what it exports, because both run the same code. And I didn't use a single framework to get here.

**Images:** `out/web-001-signature-african/slide-01.png` (AI deck, rendered from the browser), `out/web-001-editorial-clean/slide-01.png` (template deck). Both regenerate on demand with `npm run render`.

---
## 2026-09-02 — The settings file my app ignored
Status: draft

> My app silently ignored its own settings file.
>
> The API key worked, so nothing looked broken. But switching the model in .env did nothing.
>
> Why: the key is read when it's first used. The model name is read at startup. My loader ran at first use — too late for the name, just in time for the key.
>
> One moved line, every setting obeys.

**Plain English reply:** Half my configuration file was being ignored for days and it looked completely fine — the important half worked. The settings I read too early stayed frozen at the defaults. Moving the file-loader one line earlier fixed everything. This is why "it works" isn't the same as "it's wired right."

**Images:** none. A two-line diff, one line moved, is the whole image.

---
## 2026-09-03 — The bug I'd fixed the day before
Status: draft

> Yesterday I fixed a config bug: a value read too early, frozen at its default.
>
> Today I wrote it again — a new module read the DB keys at import, before the loader runs. Co## 2026-09-03 — The bug I'd fixed the day before
Status: draft

> Yesterday I fixed a config bug: a value read too early, frozen at its default.
>
> Today I wrote it again — a new module read the DB keys at import, before the loader runs. Configured or not, it said "no keys."
>
> My "degrades safely" test passed. The bug looks just like safe.

**Plain English reply:** I built the whole accounts layer — sign-in, free credits, saved work — and the tests were green. Then I noticed it would never actually see my database keys: the new file checked for them the instant it loaded, a moment before the app reads its settings. So it would always conclude "no keys," even right after I added them. Same shape as yesterday's bug — something read a beat too early. And my safety test couldn't catch it, because "no keys found" is also the correct answer when there really are none.

**Images:** none — or the `npm run verify:supabase` run, 13/13 green, once the keys are read lazily like they should be.

**Note:** Two read-timing bugs in two days is a pattern worth owning. "The tests pass" and "it's wired right" are different claims — and a test that passes for the wrong reason is the most expensive kind of green.

---

## 2026-09-03 — The third time, but at least it's the same mistake
Status: draft

> Two days in a row I shipped the same bug: code that reads something before it's ready. I told myself I'd learned it.
>
> Then I loaded the free template gallery the instant the app boots — before you've signed in, so before there's a token. The server said no. Nothing ever asked again.
>
> Signed in, you'd open "start from a template" and find it empty. No error. Just blank.

**Plain English reply:** The template gallery loads with one request. My plan fired it at startup — but with accounts on, startup happens before you sign in, so there's no key to prove who you are yet, and the server refuses. Nothing retries, so every logged-in user would hit "start from a template" and see nothing, with no error to explain it. Fix: load it the moment you actually open that screen, token in hand. Three timing bugs this week and every one did a thing before the thing it needed existed. At least the mistake is consistent.

**Images:** the network tab — one `GET /api/defaults → 401` from the old code, and that same request simply *absent* after the fix. The bug is a line that's there; the fix is a line that isn't.

**Note:** The frontend for accounts is done — sign in, a wall of your saved decks, a credit counter, an actual Save button. But the post isn't "I shipped accounts." It's that the interesting part of shipping accounts was noticing the gallery would quietly die for exactly the people who signed in.

---

## 2026-09-04 — The element the browser wanted to talk to was already gone
Status: draft

> Drag-to-reorder, on a rail where every thumbnail is a live iframe of the real slide — not a picture of one.
>
> So the thing your cursor grabs is an iframe. It swallows the drag before my code hears about it.
>
> Fix one: an invisible shield over each thumb. Dead until a drag starts, live for exactly as long as it lasts.
>
> Fix two: the drop rebuilds the rail — and deletes the element the browser was about to fire `dragend` at. The cleanup was attached to a node that no longer existed.

**Plain English reply:** The strip of slide thumbnails isn't screenshots — each one is the actual slide rendering live, which is what makes the preview *be* the export. That's great until you try to drag one, because you're really grabbing a little embedded page and it keeps the drag to itself. So every thumb gets a transparent shield laid over it: inert while you're just clicking around, switched on the instant a drag begins. Then a subtler one — when you drop, the rail redraws itself from scratch, which throws away the exact element the browser had queued its "drag finished" message for. That message went nowhere, so the shields stayed switched on over a drag that had already ended. Ending the drag at drop time instead of waiting to be told fixed it.

**Images:** the rail mid-drag — source thumb faded, target outlined in gold. Then the same rail after, renumbered.

**Note:** The part I didn't expect: reordering isn't just moving cards. Slot one *is* the hook and the last slot *is* the call to action, so dragging the hook into the middle means the slide that lands in slot one becomes the hook. The reorder has to re-label every slide by position — the same rule the server's repair pass uses — or the deck stops validating the moment you move anything. Verified it headlessly rather than by eye: drag slot 1 to slot 4, read back what each thumbnail actually renders.

---

## 2026-09-04 — My test said the button wasn't clickable. The button was fine.
Status: draft

> Added + and − to the slide rail. Wrote a script to click them. It refused: "node is either not clickable or not an Element."
>
> I nearly went hunting for the CSS bug. Instead I asked the page to measure itself.
>
> The button was 0 pixels wide. So was everything else. The whole editor was 0×0.
>
> My script wasn't signed in. The app had quietly flipped to the sign-in screen and hidden the editor. It was clicking at a screen that wasn't there.

**Plain English reply:** I'd just built add and remove slides, and my automated check couldn't press the buttons. The instinct is to blame your own layout — something's covering it, wrong stacking order, a stray overlay. So instead of guessing I had the page report the button's actual position and size, plus what element sits at that spot. Everything came back zero, and the thing at the coordinates was the top bar. That's not a layout bug; that's an editor that isn't on screen. Because the robot browser had no account, the first save-check came back "who are you?" and the app did exactly what it should — showed the login screen, hid the editor. Correct behaviour, invisible in the error message. Fix wasn't in my code at all: boot the same app with accounts switched off, on a different port, and drive it there. Then every click landed first try.

**Images:** the measurement output — `addBox: {w:0,h:0}` next to the same box on the accountless server, and the rail footer with `+ − 10/10` and a greyed-out plus.

**Note:** Worth saying what the feature is, since the bug story buried it: the rail can now add and remove slides, and the 5-to-10 limit isn't a rule I wrote twice — the buttons read the bounds off the same schema file the server validates against, so at ten slides plus simply goes dead. And add drops the new slide *before* your closing slide, never after, because the last slot *is* the call to action — appending would have quietly demoted the ending you wrote into a middle slide. The half hour I lost to a lying error message is now one command: `npm run dev:degraded`.

---

## 2026-09-04 — For two days my app had a Sign out button nobody could see
Status: draft

> I built the account strip in the header: My decks, a credit counter, your email, Sign out. Shipped it. Used the app for two days.
>
> Today a script asked the browser one question about that button — what's your `display` value? — and got back: `none`.
>
> My stylesheet says: show it once you're signed in. Bootstrap's reset says `[hidden] { display: none !important }`.
>
> The `hidden` attribute had been in my HTML since the first draft as a "start invisible" hint. CSS was supposed to undo it. `!important` from a stylesheet I didn't write outranks every rule I did.
>
> I'd looked at that header a hundred times. You don't notice what isn't there.

**Plain English reply:** The top-right of the app should show who's signed in — your email, how many AI credits you have left, a way to your saved decks, a way out. I wrote it, and it worked in my head. What actually happened: I'd marked those four things "hidden" in the HTML so they wouldn't flash on screen before the app knows whether you're logged in, then handed the job of un-hiding them to my stylesheet. But the app also loads Bootstrap, and Bootstrap contains one line saying anything marked hidden stays hidden, *no arguments* — and that "no arguments" beats anything I write. So the strip was never once on screen, for anybody. A screenshot would never have caught it, because a header with four fewer things in it just looks like a header. The only thing that catches this is asking the browser to say the value out loud. Fix: delete the attribute and let the stylesheet own it start to finish.

**Images:** the header before and after — same app, same account, one strip that finally appears. Next to it the one-line answer out of Bootstrap's own file: `[hidden]{display:none!important}`.

**Note:** The feature list this bug was hiding under: undo/redo, autosave, download as a ZIP or a PDF or a single PNG, a saved brand library, an AI tab that rewrites one slide for one credit, and click any text on the slide to edit it in place. Second bug worth a line — my own checker kept clicking the wrong thing. The slide thumbnails and the big preview are the *same file* rendering live, which is the whole point of this project: what you see is literally what exports. My script asked for "the slide preview" by its address, got handed a 120-pixel-wide thumbnail, and typed into that. The architecture I'm proudest of walked over and bit the test.

---

## 2026-09-04 — I wrote 13 tests for my own file formats. Both failures were the test's fault.
Status: draft

> My app exports a ZIP and a PDF. I wrote both formats by hand — no libraries, byte
> by byte, offset by offset. That code had zero tests, and a corrupt ZIP is not a
> crash: it's a file that opens fine on my machine and shows blank pages on yours.
>
> So the test can't use my writer to check my writer. It has to read the bytes back
> the way a real unzipper does: find the end record, walk the directory, follow every
> offset to its header, demand the two copies agree.
>
> First run, two failures. Both were mine — in the test.
>
> The ZIP test fed "random" bytes to prove they'd be stored instead of compressed.
> My random wasn't random; my writer compressed it, correctly, and the test called
> that a bug. Fix: chain SHA-256 digests, which nothing can squeeze.
>
> The PDF test searched for `/Type /Page` followed by a non-space. A PDF always has
> a space there. That pattern could never match anything, ever.
>
> Two hours, no bugs found in the thing being tested. That's not a wasted afternoon.
> That's the report: 13 checks that will scream the day I break an offset.

**Plain English reply:** When you download your carousel you get a ZIP of images or
a PDF. I built both file formats myself, from scratch, and until today nothing
checked them — which is the scary kind of untested, because a slightly broken ZIP
still looks like a ZIP until the day someone can't open it. So I wrote a reader that
takes my files apart independently and complains if anything disagrees: 13 checks,
plus 8 more that download a real carousel end to end and confirm every page really
is 1080×1350 and every slide really is in there. Everything passed. The only two
things that broke were mistakes in the checking code itself, which is oddly the
outcome you want.

**Images:** the terminal, 26 green ticks — and the two-line diff where the test was
wrong, not the code.

**Note:** The tests deliberately never call the AI. A test that spends real credits
is a test nobody runs twice, so `/api/rewrite` is only pushed as far as the guard
that runs *before* the charge. One check exists purely to prove a rejected export
never launched Chrome — refuse first, work second.

---

## 2026-09-05 — My app told a user "http_error". Twice as bad: it was true.
Status: draft

> Hit Generate. Got this back, in my own UI, in red:
>
> **http_error:** This model is currently experiencing high demand. Spikes in demand
> are usually temporary. Please try again later.
>
> Two failures in one line. The second half is Google's — the model I default to was
> full. My code had already retried three times, 1s then 3s, and got the same 503.
>
> The first half is mine. `http_error` is a label I wrote for my own logs and then
> printed at a human being.
>
> But the fix isn't a nicer message. I checked while the primary was refusing:
> another model in the same family answered the same prompt in 1.3 seconds. That 503
> is per-model. My retry loop was patiently asking the one queue that was full.
>
> So now a busy model hands the prompt to the next one. It switches on "busy" and a
> timeout, and on nothing else — because a blocked prompt fails the same way on a
> fresh model, and touring three of them would just make one clear error three times
> slower. The deck notes say which model actually wrote it.
>
> And the error now says "The model is busy", plus the thing I'd forgotten to say
> out loud: your credit was refunded.

**Plain English reply:** The app asks Google's AI to write your carousel. Yesterday
the specific AI model I'd picked was overloaded — too many people, not enough
capacity — so it turned my request down and my app passed that on to you in
programmer language, which is the worst of both worlds. Turns out the queue was only
full for *that* model; a sibling model was free and answered in about a second. So
the app now tries the next one automatically instead of waiting on a full queue, and
it only does that when the problem is actually "busy" — if your text got refused for
some other reason, trying three more times would just waste your minute. Two smaller
things fixed in the same pass: errors now read like sentences, and when a generation
fails you can *see* that your credit came back rather than having to trust me.

**Images:** the red error box before and after — `http_error:` and Google's paragraph,
next to "The model is busy" and one line about the refund.

**Note:** 4 tests cover this, and they never touch the network: I replace `fetch`,
hand the first model a 503 and the second a real deck, then assert exactly which
models were asked. The interesting assertion is the negative one — a blocked prompt
must stop at the first model. Restraint is the part of a fallback that's easy to get
wrong and impossible to notice.

---

## 2026-09-29 — The save raced the typing
Status: draft

> Autosave had a race: if a request was still running when you typed again, its old
> success could mark the newer edit “saved.” Now Storyloom serializes snapshots,
> saves the latest revision, retries failures, and waits before leaving the editor.
> The existing 30 tests still pass.

**Plain English reply:** I found a timing bug in autosave: a slow save could finish
after a newer edit and tell the app everything was safe, even though the database
only had the older version. Saves now go in order, the newest edit gets its own
write, and leaving the editor waits for that write to finish.

**Images:** none needed; a short screen recording of editing while the first save is
pending would show the race and the corrected “Saved” state.

**Note:** The current test suite does not yet include a dedicated browser test for
this race; the 30 existing tests pass, and the real account/database was not changed
during verification.

---

## 2026-09-29 — The slides were saved; the editor couldn't find them
Status: draft

> A saved 6-slide carousel opened to an empty rail and panel. The database had all
> six slides. My GET route returned the database row wrapper instead of its `deck`
> JSON column, so the editor looked for `slides` in the wrong place.
>
> One response field fixed it. Reopened the real deck: 6 thumbnails, 6/6 navigation,
> all slide fields restored.

**Plain English reply:** The carousel was in the database the whole time. The bug was
in the handoff back to the editor: I returned the storage record around the carousel,
instead of the carousel inside it. The editor got an object with no slides, so the
panel and arrows had nothing to show. Fixed the response and verified the saved deck
loads all six slides.

**Images:** screenshot of the restored editor: all six slide thumbnails, slide 3
selected, and its saved content visible in the panel.

**Note:** A read-only check confirmed the saved JSON had six slide entries; opening
the actual account's deck after the fix showed all six thumbnails and populated
fields. No deck data was changed during verification.

---

## 2026-09-29 — The logo knows where you are
Status: draft

> A logo is a home button. On the landing page, home is the landing page. In the
> signed-in app, home is the dashboard. The Storyloom logo now follows that context
> and saves a dirty deck before taking you there. One light/dark switch now follows
> you across the landing page and studio.

**Plain English reply:** Clicking the logo from inside the app used to send signed-in
users back to the marketing page. Now it takes them to their dashboard, and if
they're editing, Storyloom saves first. I also made the light/dark choice persist
when you move between the landing page and the studio.

**Images:** short recording: edit a slide, click the logo, see the saved dashboard.

---

## 2026-09-30 — The generated deck that never saved
Status: draft

> Storyloom generated a carousel, but a new deck wasn't dirty yet, so autosave never started. Now AI decks enter the save queue on arrival; browsing templates stays read-only. Verified in the browser without a model call.

**Images:** browser recording from generation finishing to the Saved state.

---

## 2026-09-30 — Admin-published starter templates
Status: draft

> Built an admin flow to publish an edited carousel as a reusable starter template.
> The gallery merges published Supabase decks with the three built-ins, and the
> server validates each deck against the same schema. The database migration still
> needs to be applied before publishing can persist.

**Images:** a published template appearing beside the three built-in gallery cards.

---

## 2026-09-30 — The deck cards finally work without a mouse
Status: draft

> Polished Storyloom's My Decks screen: each saved carousel now has a clearly named Open button that works with the keyboard, and deleting the last deck returns a useful empty state. Checked the layout at a 390px viewport; no horizontal scroll.

**Images:** mobile dashboard with a saved deck and its Open action.

---

## 2026-10-01 — The skin isn't the whole style
Status: draft

> Storyloom's preset skins were all-or-nothing. Now you can tune a deck's background,
> text, accent, and font without changing the preset structure. The same theme data
> drives the live preview and exported slides, and Reset returns to the skin.

**Images:** the Style tab beside the same slide before and after a color/font change.

---

## 2026-09-30 — A ticker that fits in your pocket
Status: draft

> The landing page ticker was one long line on phones.
>
> It clipped because it was built for desktop width.
>
> Now it loops on mobile, stays still on desktop, and respects reduced motion.

**Images:** none needed.

---

## 2026-09-30 - Confirmation links went to localhost
Status: draft

> A signup confirmation email sent my phone to localhost.
>
> Supabase was falling back to its local Site URL because signup didn't provide a redirect.
>
> Storyloom now sends confirmation links back to the site the signup came from, with a resend action for stale links.

**Images:** none needed.

---

## 2026-09-30 - Storyloom on a phone
Status: draft

> Started making Storyloom usable on a Galaxy-sized screen.
>
> The editor had a desktop toolbar and a preview built around 1080px slides.
>
> Now the slide fits the phone, with the controls still reachable.

**Images:** phone-width editor with slide rail and controls.

---

## 2026-09-30 - A real mobile menu for Storyloom
Status: draft

> Reworked the phone navigation around what people need next.
>
> Big, divided links make the landing page scannable; sign-in and the studio stay pinned below.
>
> Same Storyloom theme, with a full-height drawer instead of a tiny dropdown.

**Images:** open Storyloom mobile navigation at 360px.

---

## 2026-10-01 - Make the homepage show the output
Status: draft

> Tightened Storyloom's homepage around its real promise: text or a link in, an editable carousel out.
>
> The hero now sends people straight to the studio, and the examples are actual starter decks with the real output specs.

**Images:** refreshed hero and example bento.

---

## 2026-10-01 - Bring the landing style into the studio
Status: draft

> Reworked the signed-in dashboard around starting and continuing a carousel.
>
> The studio now shares the landing page's width and header alignment, with saved decks still one scroll away.

**Images:** the dashboard welcome panel and saved-deck grid at desktop and phone widths.

---

## 2026-10-01 - One type voice across Storyloom
Status: draft

> Storyloom's landing page and studio used different interface fonts.
>
> Unified both on Manrope while keeping monospace only where technical text needs it.
>
> Same voice from first visit to finished deck.

**Images:** landing hero beside the signed-in studio.

---

## 2026-10-02 - Keep auth state in sync
Status: draft

> A slow dashboard request made Storyloom show the sign-in form beside an already signed-in account header.
>
> The loading view now stays up until account data is ready, and account controls stay hidden on auth/loading screens.
>
> Small state mismatches make a product feel broken; this one was just two async transitions finishing at different times.

**Images:** sign-in/loading transition before and after.

---

## 2026-10-02 - The renderer needed its browser
Status: draft

> Storyloom's editor loaded on Render, but preview and downloads failed because the server had no Chrome for Puppeteer to launch.
>
> I added a runtime startup check as well as the build install, so Chrome is present in the same cache the running server uses.
>
> A server can be healthy and still be missing the one runtime dependency that makes its main feature work.

**Images:** the failed render message and a successful slide preview/export.

---
f58104F56804