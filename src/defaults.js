/**
 * Path B starter decks — template-first, no model call, free and unlimited.
 *
 * One per style. These are what the gallery shows and what the editor opens when
 * the user does not want to spend a credit, so they have to look like a finished
 * carousel rather than lorem ipsum: the thumbnail *is* the sales pitch for the
 * style. The content is generic enough to replace and good enough to keep.
 *
 * Every deck carries a placeholder `brand`. fixtures/sample-ugly.json has no
 * brand object and rendered with an empty footer — correct behaviour, but it
 * means a template-first deck without one opens looking broken, and the user
 * has no obvious hint that a name and handle are things they can set.
 *
 * Each deck also exercises the fields its style renders best: taglines and
 * highlight words for signature-african, longer prose for editorial-clean's
 * serif, bullets for mono-terminal's ▸ markers.
 */
import { schema, validateDeck } from './validate.js';

export const PLACEHOLDER_BRAND = { name: 'Your name', handle: '@yourhandle' };

const decks = {
  'signature-african': {
    narrative_type: 'listicle',
    title: '5 rules for posts that travel',
    slides: [
      {
        tagline: 'THE RULES',
        heading: '5 rules for posts that actually travel',
        subtitle: 'Reach is a craft, not an accident.',
        highlight_words: ['travel'],
      },
      {
        tagline: 'Rule 1',
        heading: 'Earn the first two seconds',
        body: 'Nobody decides to read your post. They decide to stop scrolling. Those are different decisions, and only the second one is yours to win.',
        highlight_words: ['first two seconds'],
      },
      {
        tagline: 'Rule 2',
        heading: 'One idea per slide',
        body: 'If a slide needs the word "also", it is two slides. Splitting costs you nothing and buys the reader a place to breathe.',
        highlight_words: ['One idea'],
      },
      {
        tagline: 'Rule 3',
        heading: 'Be specific or be skipped',
        body: 'A number, a name, or a moment beats an adjective every time. "Faster" is a claim. "Nine seconds to two" is a reason to believe you.',
        highlight_words: ['specific'],
      },
      {
        tagline: 'YOUR TURN',
        heading: 'Replace this with your own',
        body: 'Every word here is editable. Change the text, switch the style, keep the layout.',
        cta: { label: 'Start editing' },
        highlight_words: ['your own'],
      },
    ],
  },

  'editorial-clean': {
    narrative_type: 'story',
    title: 'The draft nobody wanted to write',
    slides: [
      {
        tagline: 'A SHORT STORY',
        heading: 'The draft nobody wanted to write',
        subtitle: 'It was the one that worked.',
        highlight_words: ['nobody wanted'],
      },
      {
        heading: 'The version that felt safe',
        body: 'It said the agreeable thing in the agreeable way. It could have been written by anyone, about anything, which is exactly why it reached no one.',
        highlight_words: ['safe'],
      },
      {
        heading: 'The sentence that felt risky',
        body: 'One line named the thing everyone had been avoiding. Cutting it would have been the comfortable choice, and it stayed in.',
        highlight_words: ['risky'],
      },
      {
        heading: 'What changed',
        body: 'Fewer people agreed. Far more people replied. Agreement is quiet and disagreement is loud, and only one of them is a conversation.',
        highlight_words: ['replied'],
      },
      {
        tagline: 'YOUR TURN',
        heading: 'Tell yours here',
        subtitle: 'Same layout, your words.',
        body: 'Swap this text for the story you have been putting off.',
        cta: { label: 'Start editing' },
      },
    ],
  },

  'mono-terminal': {
    narrative_type: 'how-to',
    title: 'Ship a side project in one weekend',
    slides: [
      {
        tagline: 'FRIDAY → SUNDAY',
        heading: 'Ship a side project in one weekend',
        subtitle: 'Four steps. No new frameworks.',
        highlight_words: ['one weekend'],
      },
      {
        tagline: 'STEP 1',
        heading: 'Cut the idea until it fits',
        body: 'Write the one sentence a user would say to a friend. Everything not in that sentence is version two.',
        highlight_words: ['one sentence'],
      },
      {
        tagline: 'STEP 2',
        heading: 'Build the boring middle first',
        bullets: [
          'The part that must work, before the part that must look good',
          'Hard-code anything you can replace later',
          'No accounts, no settings, no dashboard',
          'One happy path, end to end',
        ],
        highlight_words: ['boring middle'],
      },
      {
        tagline: 'STEP 3',
        heading: 'Use it yourself before you show it',
        body: 'Ten minutes as your own first user finds more than an hour of reading the code will.',
        highlight_words: ['yourself'],
      },
      {
        tagline: 'STEP 4',
        heading: 'Ship it unfinished',
        body: 'A weekend project that exists beats a month-long one that does not. Replace this text and go.',
        cta: { label: 'Start editing' },
        highlight_words: ['unfinished'],
      },
    ],
  },
};

export const STYLES = ['signature-african', 'editorial-clean', 'mono-terminal'];

/**
 * Build a ready-to-edit deck for a style.
 *
 * @param {string} styleId
 * @param {object} [opts]
 * @param {object} [opts.brand]      the user's real brand, if they have one saved
 * @param {string} [opts.platform]
 * @param {boolean} [opts.watermark]
 * @param {boolean} [opts.page_labels=true]
 */
export function defaultDeck(styleId, opts = {}) {
  const style = STYLES.includes(styleId) ? styleId : STYLES[0];
  const base = decks[style];
  const n = base.slides.length;

  return {
    format: 'carousel',
    platform: schema.properties.platform.enum.includes(opts.platform)
      ? opts.platform
      : schema.properties.platform.enum[0],
    aspect_ratio: '4:5',
    style_id: style,
    narrative_type: base.narrative_type,
    source: 'template',
    title: base.title,
    watermark: opts.watermark !== false,
    brand: opts.brand ?? PLACEHOLDER_BRAND,
    slides: base.slides.map((s, i) => ({
      ...s,
      type: i === 0 ? 'hook' : i === n - 1 ? 'cta' : 'body',
      ...(opts.page_labels === false ? {} : { page_label: `${i + 1}/${n}` }),
    })),
  };
}

/** Every starter deck, for the Path B gallery. */
export function allDefaults(opts = {}) {
  return STYLES.map((style) => defaultDeck(style, opts));
}

// CLI: node src/defaults.js [--write]  — validate all three, optionally dump to fixtures/
if (process.argv[1]?.endsWith('defaults.js')) {
  const write = process.argv.includes('--write');
  let failed = 0;
  for (const style of STYLES) {
    const deck = defaultDeck(style);
    const { valid, errors } = validateDeck(deck);
    console.log(
      `${valid ? 'PASS' : 'FAIL'}  ${style.padEnd(19)} ${deck.slides.length} slides · brand="${deck.brand.name}"`
    );
    if (!valid) {
      failed++;
      errors.forEach((e) => console.log(`        ${e}`));
    }
    if (write) {
      const { writeFileSync } = await import('node:fs');
      const path = `fixtures/default-${style}.json`;
      writeFileSync(path, `${JSON.stringify(deck, null, 2)}\n`);
      console.log(`        written to ${path}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}
