# Storyloom Landing Page Brief

**Status:** Product-accurate first draft  
**Updated:** 2026-09-29  
**Reference:** [Supasides](https://supaslides.app/)

## Product

Storyloom turns pasted text or an article URL into an editable, on-brand carousel for LinkedIn or Instagram. It helps people who already have an idea or useful writing turn it into designed slides without laying out each slide themselves.

**Short description:** Text in. On-brand carousel out.

The core product is a web app, not a story-world or illustration generator. AI writes and structures the slide content; the HTML/CSS template renders the design and text. The browser preview and exported images use the same template.

## Audience and positioning

**Primary audience:** Creators, founders, and small teams who want to repurpose ideas or articles into social carousels without designing every slide manually.

**Positioning:** Faster than building a carousel slide by slide, with more control over the output than a raw AI-written script. Users can edit the copy, apply their brand, and export the finished slides.

**Recommended voice:** Clear, capable, editorial. Keep the premium visual treatment, but describe a practical creator tool rather than an imagined storytelling platform.

**Product status:** Storyloom is an MVP in active development, being prepared for testing on Render and for hackathon demos. The landing page should make that status visible. Present the current working experience honestly; do not imply that Storyloom is a fully launched, finished SaaS product.

## Hero copy

### Text in. On-brand carousel out.

Turn an idea or article into a polished carousel. Edit every slide, make it yours, and export it ready to post.

**Primary CTA:** Try the MVP  
**Secondary CTA:** See a real carousel

Use real Storyloom slide renders in the hero. A strong demo would show one deck in more than one of the three available styles, making the style switch tangible. Do not use fictional book covers, AI-generated illustrations, or mock product screens that Storyloom does not produce.

## Page structure

### 1. Navigation

- Storyloom wordmark
- How it works
- Examples
- Sign in
- Open the studio

Do not include “For agents” until Storyloom has a public agent integration.

### 2. Hero and product proof

Pair the headline with real carousel slides. Show the input-to-output transformation, ideally with a short, captioned demo: source text or URL, generated deck, style change, then export. Make it clear that the slides shown are actual Storyloom output.

A useful supporting line beneath the preview: **One idea. Five to ten editable slides.**

### 3. Two ways to start

**Generate from text or a link**  
Storyloom can turn pasted writing or an article URL into slide copy. AI generation uses one credit.

**Start from a template**  
Choose a starter deck and edit it yourself. This path makes no AI call and is free to use in the app.

Present these as distinct choices. Do not imply that the template path requires AI or that AI generation is unlimited.

### 4. What users can do

- **Start with their own material:** Paste text or provide an article URL.
- **Shape the story:** Choose a listicle, how-to, story, myth-bust, case-study, or manual structure.
- **Make it look on-brand:** Save brand details and choose among three styles: Signature African, Editorial Clean, and Mono Terminal.
- **Edit the result:** Change slide text in the editor or directly on the preview, reorder slides, add or remove slides, and undo or redo.
- **Export the deck:** Download slides as PNG, a PDF, or a ZIP archive.

Keep feature copy grounded in these shipped capabilities. Avoid claims about AI image generation, automatic scheduling or posting, a large style library, brand extraction from a URL, or a built-in continuity critic.

### 5. How it works

1. **Add text or a URL.** Start with your own writing or an article.
2. **Choose a structure and style.** Pick the slide count, narrative shape, platform, and visual style.
3. **Edit your carousel.** Adjust the words and order, add or remove slides, and apply your brand.
4. **Export and post.** Download a PNG, PDF, or ZIP.

### 6. Examples

Show a small set of real decks, not invented customer work. Use examples that make the three shipped styles easy to compare. Label any sample content as a demo if it does not come from a real customer.

Good proof for the first version is a clear output, not a fabricated testimonial or engagement statistic. Add customer quotes and performance data later only with permission and a source.

### 7. MVP access and pricing

Include this section rather than hiding pricing completely, but frame it around the current testing phase instead of presenting mature subscription tiers. Suggested copy:

> **MVP access**  
> Storyloom is in development and being tested with hackathon participants. Start with a template for free, or use available credits to generate a carousel with AI. Commercial plans and pricing have not been finalized.

Template-first creation does not call the model; AI generation uses one credit. Confirm what Render testers will receive before promising free AI generations, a no-credit-card trial, or a specific credit allowance. Do not invent dollar prices, paid tiers, or unlimited AI generation.

### 8. FAQ

Suggested questions, with direct answers:

- What can I use as a starting point?
- Which platforms and formats are supported?
- Can I edit the slides after generation?
- What can I download?
- Does starting from a template use AI credits?
- Does Storyloom generate images?

Be explicit: the current output is a 4:5 carousel, 1080 × 1350 pixels, with 5–10 slides. Supported platform labels are LinkedIn and Instagram. Storyloom does not generate slide illustrations.

### 9. Final CTA

**Help shape the next version of Storyloom.**  
Try the MVP, turn an idea into a carousel, and share feedback while the product is in development.

**CTA:** Try the MVP

Only use this copy once the Render test deployment is live and the CTA is wired to its working app entry point. Keep a secondary path to view sample output if the app is temporarily unavailable.

## Visual direction

Keep the dark, premium editorial direction from the original concept, but make the product itself the visual material. Use actual carousel slides as a typographic collage or carefully arranged preview rail. The three styles provide meaningful visual contrast without inventing art-generation capabilities.

Use restrained motion: a short staggered reveal or a slow carousel progression, plus a compact ticker if it does not compete with the demo. Avoid generic floating-image decoration. Make slide dimensions stable so text and controls do not shift while previews load. Ensure the layout works on mobile, where the current editor still needs a dedicated phone layout.

## What to learn from Supasides

Supasides makes the workflow and output concrete, gives visitors a low-friction way to try the product, layers feature detail after the demo, and uses testimonials, sourced metrics, pricing, FAQs, and agent documentation to answer trust questions.

For Storyloom's first landing page, prioritize the same clarity and proof: show the real workflow, state what the output is, and answer practical questions. Do not copy Supasides' feature breadth, pricing, customer evidence, or agent claims. Those are specific to its product.

## Product boundaries

Do not claim these as current Storyloom features:

- Story universes, character bibles, plot-hole detection, or an AI story critic
- AI-generated imagery or automatic image placement
- Posters, 9:16 covers, thumbnails, logo concepts, or campaign packs
- Animated video exports, scheduling, or automatic social publishing
- Brand extraction from a website URL
- x402, MCP, agent access, or a public API
- 40+ styles or multi-platform aspect ratios

Current supported carousel contract: 5–10 slides, 4:5, 1080 × 1350, LinkedIn or Instagram; export as PNG, PDF, or ZIP.

## Route and launch decisions

The existing app is served at `/`; there is no separate `/studio` route today. Before building a marketing homepage at `/`, decide where the existing app will live. Recommended structure: marketing page at `/`, app at `/studio`, with sign-in and CTA links wired to the correct routes. Treat `/studio` as a new route to implement, not an existing capability.

**Testing host:** Render is the planned host for the MVP. The Render deployment is for evaluation and hackathon testing, not a claim that production launch is complete. Verify the deployed app, authentication, environment variables, and Puppeteer/Chrome rendering before sending visitors to the CTA.

Use a compact status label near the hero or CTA, such as **MVP in development · Testing on Render**. Avoid launch language like “fully available,” “production-ready,” or claims of a mature customer base.

## Decisions still needed

- For the MVP page, prioritize hackathon judges and testers; keep creators and founders as the broader intended audience.
- Choose the real sample decks to feature and confirm permission for any customer work.
- Confirm the Render test access terms and available credits before publishing the MVP pricing copy above.
- Confirm the final CTA and route after the app/landing-page routing decision.
- Add real testimonials or sourced outcome data only when available.

## Implementation note

Build the first version in the existing Node/Express and HTML/CSS/vanilla-JavaScript application. The current project does not use Next.js, Tailwind, or Framer Motion; adding that stack just for a landing page would increase deployment and maintenance work. Reuse the existing carousel template and real fixtures for demo visuals.
