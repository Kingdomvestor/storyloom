/**
 * app.js — the browser half.
 *
 * Two rules this file follows and shouldn't stop following:
 *
 * 1. It renders nothing itself. Every pixel of a slide comes from the iframe
 *    running /templates/carousel.html — the same file Puppeteer opens. The
 *    moment this file starts drawing slides, WYSIWYG is gone.
 *
 * 2. It hardcodes no limits. Character caps, style ids, narrative types and
 *    slide bounds all arrive from /api/meta, which reads them off the JSON
 *    schema. A cap that moves in the schema moves here on the next reload.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

const TITLE_CASE = {
  'signature-african': 'Signature African',
  'editorial-clean': 'Editorial Clean',
  'mono-terminal': 'Mono Terminal',
};
const label = (s) => TITLE_CASE[s] ?? s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const SAMPLE = `Most side projects die in the middle. Not at the idea — ideas are cheap and \
exciting — and not at launch, because anything that reaches launch was already going to make it. \
They die three days in, at the unglamorous part: the data model, the error states, the thing that \
has to work before anything can look good.

The fix isn't motivation. It's ordering. Build the boring middle first, while you still have \
enthusiasm to spend on it, and save the fun surface work for the days when you have none left. \
Hard-code everything you can replace later. Ship one path end to end before you widen it.

A weekend project that exists beats a month-long one that doesn't.`;

// --------------------------------------------------------------------- state
const state = {
  meta: null,
  deck: null,
  index: 0,
  warnings: [],
  errors: [],
  compose: { src: 'text', slides: 'auto', narrative: 'listicle', style: 'signature-african', platform: 'linkedin' },
};

// ----------------------------------------------------------------- transport
async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, kind: 'bad_response', message: `${res.status} ${res.statusText}` };
  }
  return data;
}

// ------------------------------------------------------------------- frames
/**
 * Wait for a template iframe to expose window.STORYLOOM. Polling rather than a
 * load listener because a frame may already be loaded by the time we look, and
 * `load` never fires twice.
 */
async function frameApi(iframe, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const found = iframe.contentWindow?.STORYLOOM;
    if (found) return found;
    await sleep(40);
  }
  console.warn('preview frame never came up', iframe);
  return null;
}

async function show(iframe, deck, index = 0) {
  const frame = await frameApi(iframe);
  if (!frame) return;
  frame.setDeck(deck);
  if (index) frame.renderSlide(index);
}

/**
 * Size a preview well and scale its 1080-wide iframe to fit.
 *
 * `setWidth` is false wherever the wrapper should keep taking its width from the
 * layout (the gallery cards). Writing an explicit width there would pin the
 * element to whatever it measured on first paint, and every later measurement
 * would just read that value back — a fixed point it can never grow out of.
 */
function scaleFrame(wrapper, iframe, width, { setWidth = true } = {}) {
  const scale = width / 1080;
  iframe.style.transform = `scale(${scale})`;
  if (setWidth) wrapper.style.width = `${Math.round(width)}px`;
  wrapper.style.height = `${Math.round(1350 * scale)}px`;
}

// ======================================================================= BOOT
async function boot() {
  const meta = await api('/api/meta');
  if (!meta.ok) {
    $('#composeErr').hidden = false;
    $('#composeErr').textContent = 'Could not reach the server.';
    return;
  }
  state.meta = meta;
  state.compose.style = meta.styles[0];
  state.compose.narrative = meta.narratives[0];
  state.compose.platform = meta.platforms[0];

  $('#modelName').textContent = meta.hasApiKey ? meta.model : 'no key';
  if (!meta.hasApiKey) {
    $('#modelPill').classList.add('off');
    $('#noKeyWarn').hidden = false;
    $('#generateBtn').disabled = true;
  }

  buildSeg('#segSlides', ['auto', ...range(meta.slides.min, meta.slides.max).map(String)],
    state.compose.slides, (v) => (state.compose.slides = v));
  // 'manual' is what a hand-edited deck reports about itself, not a shape you
  // can ask the model for — so it stays out of the picker but in the schema.
  buildSeg('#segNarrative', meta.narratives.filter((n) => n !== 'manual'),
    state.compose.narrative, (v) => (state.compose.narrative = v), label);
  buildSeg('#segPlatform', meta.platforms, state.compose.platform,
    (v) => (state.compose.platform = v), (p) => (p === 'linkedin' ? 'LinkedIn' : 'Instagram'));
  buildStylePicker();

  wireCompose();
  wireEditor();
  loadGallery();
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * Mark `chosen` as the live button in a single-select row and clear the rest,
 * keeping the ARIA state in step with the `.on` class. Four rows in this app
 * behave this way, and before this helper existed all four toggled the class
 * and none of them said anything to a screen reader.
 *
 * `attr` is aria-selected for the two tab rows, aria-pressed for everything
 * else. Note what is deliberately absent: role="radio". That role obliges
 * arrow-key navigation and a single tab stop for the group, and a
 * half-implemented radiogroup reads worse than a plain row of labelled toggles.
 */
function selectOne(group, chosen, attr = 'aria-pressed') {
  for (const b of group) {
    b.classList.toggle('on', b === chosen);
    b.setAttribute(attr, String(b === chosen));
  }
}

function buildSeg(sel, values, current, onPick, fmt = (v) => v) {
  const host = $(sel);
  host.innerHTML = '';
  for (const v of values) {
    const b = document.createElement('button');
    b.textContent = fmt(v);
    b.dataset.v = v;
    b.setAttribute('aria-pressed', String(v === current));
    if (v === current) b.classList.add('on');
    b.onclick = () => {
      selectOne($$('button', host), b);
      onPick(v);
    };
    host.appendChild(b);
  }
}

/**
 * The style swatches are token samples, not screenshots: an eyebrow rule, two
 * heading bars and a body bar, coloured by each skin's own variables in app.css.
 * A real 1080×1350 iframe per style would be six more documents on the landing
 * screen for information three rectangles already carry.
 */
function buildStylePicker() {
  const host = $('#stylePicker');
  host.innerHTML = '';
  for (const s of state.meta.styles) {
    const card = document.createElement('button');
    card.className = 'stylecard' + (s === state.compose.style ? ' on' : '');
    card.setAttribute('aria-pressed', String(s === state.compose.style));
    card.innerHTML =
      `<div class="sw" data-s="${s}" aria-hidden="true"><i class="eyebrow"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i></div>`;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = label(s);
    card.appendChild(nm);
    card.onclick = () => {
      state.compose.style = s;
      selectOne($$('.stylecard', host), card);
    };
    host.appendChild(card);
  }
}

// ==================================================================== COMPOSE
function wireCompose() {
  // source tabs
  $$('.seg-source button').forEach((b) => {
    b.onclick = () => {
      state.compose.src = b.dataset.src;
      selectOne($$('.seg-source button'), b, 'aria-selected');
      $$('.src-pane').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.src));
    };
  });

  const ta = $('#sourceText');
  const count = () => ($('#textCount').textContent = `${ta.value.length.toLocaleString()} characters`);
  ta.oninput = count;
  $('#fillSample').onclick = () => {
    ta.value = SAMPLE;
    count();
    ta.focus();
    // focus() drops the caret at the end and scrolls there, so the sample lands
    // showing its last line. Put both back to the top — the point of a sample is
    // that you read it from the start.
    ta.setSelectionRange(0, 0);
    ta.scrollTop = 0;
  };

  $('#peekBtn').onclick = peek;
  $('#generateBtn').onclick = generate;
  $('#sourceUrl').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); generate(); } };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); };
}

async function peek() {
  const url = $('#sourceUrl').value.trim();
  const box = $('#peek');
  if (!url) return;
  box.hidden = false;
  box.textContent = 'Fetching…';
  const r = await api('/api/extract', { url });
  box.innerHTML = '';
  if (!r.ok) {
    box.style.color = '#FF9EA1';
    box.textContent = r.message;
    return;
  }
  box.style.color = '';
  const head = document.createElement('b');
  head.textContent = `${r.title || 'Untitled'}${r.siteName ? ` — ${r.siteName}` : ''} · ${r.chars.toLocaleString()} chars`;
  box.appendChild(head);
  box.appendChild(document.createTextNode(`${r.text.slice(0, 700)}…`));
}

/**
 * Staged copy, because the honest wait is 10–16 seconds and a dead button for
 * that long reads as broken. Every line is a step that actually happens — the
 * point is to tell the truth at a readable pace, not to fill the silence.
 */
const STAGES_TEXT = [
  'Reading your text…',
  'Choosing the shape of the story…',
  'Writing the slides…',
  'Checking every character limit…',
  'Still going — long inputs take a beat…',
];
const STAGES_URL = ['Fetching the page…', 'Stripping nav, ads and footers…', ...STAGES_TEXT.slice(1)];

async function generate() {
  const btn = $('#generateBtn');
  if (btn.disabled) return;
  const err = $('#composeErr');
  err.hidden = true;

  const fromUrl = state.compose.src === 'url';
  const payload = {
    slide_count: state.compose.slides === 'auto' ? 'auto' : Number(state.compose.slides),
    narrative_type: state.compose.narrative,
    style_id: state.compose.style,
    platform: state.compose.platform,
    brand: brandFromInputs(),
    instructions: $('#instructions').value.trim() || undefined,
  };
  if (fromUrl) payload.url = $('#sourceUrl').value.trim();
  else payload.text = $('#sourceText').value.trim();

  if (!payload.text && !payload.url) {
    err.hidden = false;
    err.textContent = fromUrl ? 'Paste a link first.' : 'Paste some text first.';
    return;
  }

  /**
   * One ticker owns both the clock and the message. Two intervals writing the
   * same node race, and the loser's copy flickers back a beat later.
   *
   * Past the staged lines the wait stops being routine, so the copy stops
   * pretending it is: generate.js retries a timed-out call three times at
   * GEMINI_TIMEOUT_MS each, which puts the true worst case in minutes. A
   * cheerful line that has plainly stopped being true is worse than silence,
   * and the elapsed seconds are the one thing here that cannot be wrong.
   */
  const stages = fromUrl ? STAGES_URL : STAGES_TEXT;
  const startedAt = Date.now();
  const msg = $('#workingMsg');
  const clock = $('#workingClock');

  msg.textContent = stages[0];
  clock.textContent = '';
  $('#working').hidden = false;
  btn.disabled = true;

  const ticker = setInterval(() => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    // Held back a few seconds: a counter that flashes "1s" and vanishes on a
    // fast response makes the fast response feel like it needed watching.
    clock.textContent = secs >= 3 ? `${secs}s` : '';
    msg.textContent =
      secs >= 90
        ? 'Retrying — the model timed out at least once.'
        : secs >= 45
          ? 'Slower than usual. Still waiting on the model…'
          : stages[Math.min(Math.floor(secs / 3.2), stages.length - 1)];
  }, 1000);

  const result = await api('/api/generate', payload);

  clearInterval(ticker);
  $('#working').hidden = true;
  btn.disabled = false;

  if (!result.ok) {
    err.hidden = false;
    err.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = `${result.kind}: `;
    err.appendChild(b);
    err.appendChild(document.createTextNode(result.message));
    return;
  }
  openEditor(result.deck, result);
}

// ---------------------------------------------------------------- gallery (B)
async function loadGallery() {
  const r = await api('/api/defaults');
  const host = $('#gallery');
  host.innerHTML = '';
  if (!r.ok) return;

  for (const deck of r.decks) {
    const card = document.createElement('button');
    card.className = 'gcard';
    card.innerHTML =
      `<div class="shot"><iframe src="/templates/carousel.html" scrolling="no" tabindex="-1"></iframe></div>` +
      `<div class="meta"><b></b><span></span></div>` +
      `<div class="use">Use this &rarr;</div>`;
    $('.meta b', card).textContent = deck.title;
    $('.meta span', card).textContent =
      `${label(deck.style_id)} · ${deck.slides.length} slides · ${label(deck.narrative_type)}`;
    card.onclick = () => openEditor(structuredClone(deck), { source: 'template' });
    host.appendChild(card);

    const shot = $('.shot', card);
    const iframe = $('iframe', card);
    scaleFrame(shot, iframe, shot.clientWidth, { setWidth: false });
    show(iframe, deck, 0);
  }

  // Card width follows the viewport; the iframe is a fixed 1080, so only the
  // scale factor has to keep up.
  new ResizeObserver(() => {
    $$('.gcard').forEach((c) => {
      const s = $('.shot', c);
      scaleFrame(s, $('iframe', c), s.clientWidth, { setWidth: false });
    });
  }).observe(host);
}

// ===================================================================== EDITOR
function openEditor(deck, info = {}) {
  state.deck = deck;
  state.index = 0;
  document.documentElement.dataset.view = 'editor';

  $('#deckTitle').value = deck.title ?? '';
  const src = $('#deckSource');
  src.textContent = deck.source === 'ai' ? 'AI' : 'Template';
  src.dataset.src = deck.source;

  const note = $('#stageNote');
  note.textContent = info.degraded
    ? 'This deck needed repairing — some text was truncated to fit. Worth a read before you post it.'
    : '';

  buildRail();
  buildStyleTab();
  buildBrandTab();
  selectSlide(0);
  fitStage();
  revalidate();
}

function wireEditor() {
  $('#backBtn').onclick = () => { document.documentElement.dataset.view = 'compose'; };
  $('#prevSlide').onclick = () => selectSlide(state.index - 1);
  $('#nextSlide').onclick = () => selectSlide(state.index + 1);
  $('#renderBtn').onclick = renderPngs;
  $('#sheetX').onclick = () => ($('#sheet').hidden = true);
  $('#sheet').onclick = (e) => { if (e.target === $('#sheet')) $('#sheet').hidden = true; };

  $('#deckTitle').oninput = (e) => {
    state.deck.title = e.target.value;
    revalidate();
  };

  $$('#panelTabs button').forEach((b) => {
    b.onclick = () => {
      selectOne($$('#panelTabs button'), b, 'aria-selected');
      $$('.panel-body').forEach((p) => (p.hidden = p.dataset.tab !== b.dataset.tab));
    };
  });

  new ResizeObserver(fitStage).observe($('#stage'));

  document.addEventListener('keydown', (e) => {
    if (document.documentElement.dataset.view !== 'editor') return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') selectSlide(state.index - 1);
    if (e.key === 'ArrowRight') selectSlide(state.index + 1);
  });
}

/**
 * Fit the 1080×1350 preview into whatever the stage column has left after the
 * nav row and the note. Both are measured rather than assumed, because the note
 * wraps to two lines when a deck comes back degraded.
 */
function fitStage() {
  const stage = $('#stage');
  if (!stage.clientHeight) return;
  const chrome =
    40 + // .stage vertical padding
    28 + // two 14px flex gaps
    $('.stage-nav').getBoundingClientRect().height +
    $('.stage-note').getBoundingClientRect().height;
  const availH = stage.clientHeight - chrome;
  const availW = stage.clientWidth - 40;
  const width = Math.max(180, Math.min(availW, (availH * 1080) / 1350));
  scaleFrame($('#stageFrame'), $('#preview'), width);
}

// -------------------------------------------------------------------- rail
function buildRail() {
  const rail = $('#rail');
  rail.innerHTML = '';
  const width = Math.min(132, Math.max(84, rail.clientWidth - 22));

  state.deck.slides.forEach((_s, i) => {
    const thumb = document.createElement('button');
    thumb.className = 'rthumb';
    thumb.innerHTML = `<iframe src="/templates/carousel.html" scrolling="no" tabindex="-1"></iframe><span class="n"></span>`;
    $('.n', thumb).textContent = String(i + 1);
    thumb.onclick = () => selectSlide(i);
    rail.appendChild(thumb);
    scaleFrame(thumb, $('iframe', thumb), width);
    show($('iframe', thumb), state.deck, i);
  });
}

/** Refresh one rail thumbnail (used while typing — the other nine don't change). */
const refreshThumb = debounce(async (i) => {
  const thumb = $$('.rthumb')[i];
  if (thumb) await show($('iframe', thumb), state.deck, i);
}, 260);

/** Refresh every thumbnail (used when a deck-wide setting changes). */
async function refreshAllThumbs() {
  const frames = $$('.rthumb iframe');
  for (let i = 0; i < frames.length; i++) await show(frames[i], state.deck, i);
}

// ------------------------------------------------------------------- stage
function selectSlide(i) {
  const n = state.deck.slides.length;
  state.index = Math.max(0, Math.min(i, n - 1));
  const s = state.deck.slides[state.index];

  $$('.rthumb').forEach((t, idx) => t.classList.toggle('on', idx === state.index));
  $('#slidePos').textContent = `${state.index + 1} / ${n}`;
  $('#typePill').textContent = s.type;
  $('#prevSlide').disabled = state.index === 0;
  $('#nextSlide').disabled = state.index === n - 1;

  show($('#preview'), state.deck, state.index);
  buildContentTab();
}

const refreshPreview = debounce(() => show($('#preview'), state.deck, state.index), 130);

// ------------------------------------------------------------- content tab
const capClass = (len, cap) => (len >= cap ? 'full' : len >= cap * 0.85 ? 'near' : '');

const TEXT_FIELDS = [
  { key: 'tagline', label: 'Tagline', cap: 'tagline', tag: 'input',
    why: 'Eyebrow line. Rendered uppercase and letter-spaced in every skin.' },
  { key: 'heading', label: 'Heading', cap: 'heading', tag: 'textarea', rows: 2,
    why: 'Auto-sized to fill whatever room the rest of the slide leaves it.' },
  { key: 'subtitle', label: 'Subtitle', cap: 'subtitle', tag: 'input' },
  { key: 'body', label: 'Body', cap: 'body', tag: 'textarea', rows: 4 },
];

function fieldShell(id, labelText, len, cap, why) {
  const wrap = document.createElement('div');
  wrap.className = 'f';
  const lab = document.createElement('label');
  lab.setAttribute('for', id);
  lab.textContent = labelText;
  const cnt = document.createElement('span');
  cnt.className = `cnt ${capClass(len, cap)}`;
  cnt.textContent = `${len}/${cap}`;
  lab.appendChild(cnt);
  wrap.appendChild(lab);
  if (why) {
    const p = document.createElement('p');
    p.className = 'why';
    p.textContent = why;
    wrap.dataset.why = why;
  }
  return { wrap, cnt };
}

function buildContentTab() {
  const host = $('#tabContent');
  const s = state.deck.slides[state.index];
  const caps = state.meta.caps;
  host.innerHTML = '';

  for (const f of TEXT_FIELDS) {
    const value = s[f.key] ?? '';
    const cap = caps[f.cap];
    const id = `f-${f.key}`;
    const { wrap, cnt } = fieldShell(id, f.label, value.length, cap, f.why);

    const input = document.createElement(f.tag);
    input.id = id;
    if (f.rows) input.rows = f.rows;
    input.maxLength = cap; // the cap is the schema's, so the UI cannot author an invalid deck
    input.value = value;
    input.oninput = () => {
      const v = input.value;
      if (v) s[f.key] = v;
      else if (f.key === 'heading') s[f.key] = v; // required — let the validator complain, don't delete it
      else delete s[f.key];
      cnt.textContent = `${v.length}/${cap}`;
      cnt.className = `cnt ${capClass(v.length, cap)}`;
      refreshPreview();
      refreshThumb(state.index);
      revalidate();
    };
    wrap.appendChild(input);
    if (f.why) {
      const p = document.createElement('p');
      p.className = 'why';
      p.textContent = f.why;
      wrap.appendChild(p);
    }
    host.appendChild(wrap);
  }

  // ---- bullets
  const bHead = document.createElement('div');
  bHead.className = 'subhead';
  bHead.textContent = 'Bullets';
  const bCount = document.createElement('span');
  bCount.className = 'cnt';
  bCount.textContent = `${(s.bullets ?? []).length}/${caps.bullets}`;
  bHead.appendChild(bCount);
  host.appendChild(bHead);

  (s.bullets ?? []).forEach((text, bi) => {
    const row = document.createElement('div');
    row.className = 'bulletrow';
    const input = document.createElement('input');
    input.maxLength = caps.bullet;
    input.value = text;
    input.oninput = () => {
      s.bullets[bi] = input.value;
      refreshPreview();
      refreshThumb(state.index);
      revalidate();
    };
    const del = document.createElement('button');
    del.className = 'iconbtn';
    del.title = 'Remove bullet';
    del.textContent = '×';
    del.onclick = () => {
      s.bullets.splice(bi, 1);
      if (!s.bullets.length) delete s.bullets;
      commitStructural();
    };
    row.append(input, del);
    host.appendChild(row);
  });

  const addB = document.createElement('button');
  addB.className = 'addbtn';
  addB.textContent = '+ Add bullet';
  addB.disabled = (s.bullets ?? []).length >= caps.bullets;
  addB.onclick = () => {
    s.bullets = [...(s.bullets ?? []), 'New point'];
    commitStructural();
  };
  host.appendChild(addB);

  // ---- highlight words
  const hHead = document.createElement('div');
  hHead.className = 'subhead';
  hHead.textContent = 'Highlight words';
  const hCount = document.createElement('span');
  hCount.className = 'cnt';
  hCount.textContent = `${(s.highlight_words ?? []).length}/${caps.highlight_words}`;
  hHead.appendChild(hCount);
  host.appendChild(hHead);
  host.appendChild(buildTagBox(s));

  const hWhy = document.createElement('p');
  hWhy.className = 'why';
  hWhy.textContent =
    'Substrings to render in the accent style. Matching ignores case and extends to whole words, so "commit" also lights up "commits".';
  host.appendChild(hWhy);

  // ---- cta, final slide only
  if (state.index === state.deck.slides.length - 1) {
    const cHead = document.createElement('div');
    cHead.className = 'subhead';
    cHead.textContent = 'Call to action';
    host.appendChild(cHead);

    const value = s.cta?.label ?? '';
    const { wrap, cnt } = fieldShell('f-cta', 'Button label', value.length, caps.cta);
    const input = document.createElement('input');
    input.id = 'f-cta';
    input.maxLength = caps.cta;
    input.value = value;
    input.oninput = () => {
      if (input.value.trim()) s.cta = { label: input.value };
      else delete s.cta;
      cnt.textContent = `${input.value.length}/${caps.cta}`;
      cnt.className = `cnt ${capClass(input.value.length, caps.cta)}`;
      refreshPreview();
      refreshThumb(state.index);
      revalidate();
    };
    wrap.appendChild(input);
    host.appendChild(wrap);
  }

  renderWarnings(host);
}

/** Structural edits (adding/removing a bullet or tag) need the panel rebuilt. */
function commitStructural() {
  buildContentTab();
  show($('#preview'), state.deck, state.index);
  refreshThumb(state.index);
  revalidate();
}

/**
 * Tag editor for highlight_words.
 *
 * A tag is struck through when the substring appears nowhere on the slide — a
 * plain presence check, not a copy of the template's matcher. The subtler failure
 * (a word that matches inside a longer word) is caught by the server's lint and
 * shows in the warnings list below, so the matching rule lives in exactly one
 * place and this file can't drift from it.
 */
function buildTagBox(slide) {
  const box = document.createElement('div');
  box.className = 'tagbox';
  const words = slide.highlight_words ?? [];
  const haystack = [slide.tagline, slide.heading, slide.subtitle, slide.body, ...(slide.bullets ?? [])]
    .filter((t) => typeof t === 'string').join('\n').toLowerCase();

  words.forEach((w, wi) => {
    const tag = document.createElement('span');
    tag.className = 'tag' + (haystack.includes(w.toLowerCase()) ? '' : ' dud');
    if (!haystack.includes(w.toLowerCase())) tag.title = 'This text is not on the slide — nothing will highlight';
    tag.appendChild(document.createTextNode(w));
    const x = document.createElement('button');
    x.textContent = '×';
    x.onclick = () => {
      slide.highlight_words.splice(wi, 1);
      if (!slide.highlight_words.length) delete slide.highlight_words;
      commitStructural();
    };
    tag.appendChild(x);
    box.appendChild(tag);
  });

  const caps = state.meta.caps;
  if (words.length < caps.highlight_words) {
    const input = document.createElement('input');
    input.placeholder = words.length ? 'add…' : 'a word or phrase to accent';
    input.maxLength = caps.highlight_word;
    const commit = () => {
      const v = input.value.trim();
      if (v.length < 2) { input.value = ''; return; }
      slide.highlight_words = [...(slide.highlight_words ?? []), v];
      commitStructural();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      if (e.key === 'Backspace' && !input.value && words.length) {
        slide.highlight_words.pop();
        if (!slide.highlight_words.length) delete slide.highlight_words;
        commitStructural();
      }
    };
    input.onblur = commit;
    box.appendChild(input);
  }
  return box;
}

function renderWarnings(host) {
  if (!state.errors.length && !state.warnings.length) return;
  const head = document.createElement('div');
  head.className = 'subhead';
  head.textContent = state.errors.length ? 'Schema errors' : 'Worth a look';
  host.appendChild(head);

  const ul = document.createElement('ul');
  ul.className = 'warnlist';
  for (const e of state.errors) {
    const li = document.createElement('li');
    li.className = 'bad';
    li.textContent = e;
    ul.appendChild(li);
  }
  for (const w of state.warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    const hit = /^slides\/(\d+)/.exec(w);
    if (hit) {
      li.style.cursor = 'pointer';
      li.title = `Go to slide ${Number(hit[1]) + 1}`;
      li.onclick = () => selectSlide(Number(hit[1]));
    }
    ul.appendChild(li);
  }
  host.appendChild(ul);
}

// --------------------------------------------------------------- style tab
function buildStyleTab() {
  const host = $('#tabStyle');
  host.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'subhead';
  head.textContent = 'Skin';
  host.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'styles';
  for (const s of state.meta.styles) {
    const card = document.createElement('button');
    card.className = 'stylecard' + (s === state.deck.style_id ? ' on' : '');
    card.setAttribute('aria-pressed', String(s === state.deck.style_id));
    card.innerHTML =
      `<div class="sw" data-s="${s}" aria-hidden="true"><i class="eyebrow"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i></div>`;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = label(s);
    card.appendChild(nm);
    card.onclick = async () => {
      state.deck.style_id = s;
      selectOne($$('.stylecard', grid), card);
      // Same JSON, different stylesheet — this is the restyle-is-free claim,
      // and it is the one interaction in the app that has to feel instant.
      await show($('#preview'), state.deck, state.index);
      refreshAllThumbs();
    };
    grid.appendChild(card);
  }
  host.appendChild(grid);

  const pHead = document.createElement('div');
  pHead.className = 'subhead';
  pHead.textContent = 'Platform';
  host.appendChild(pHead);
  const pSeg = document.createElement('div');
  pSeg.className = 'seg';
  pSeg.id = 'segPlatform2';
  host.appendChild(pSeg);
  buildSeg('#segPlatform2', state.meta.platforms, state.deck.platform,
    (v) => { state.deck.platform = v; revalidate(); },
    (p) => (p === 'linkedin' ? 'LinkedIn' : 'Instagram'));

  host.appendChild(toggleRow('Watermark', 'Free tier shows it. Enforced server-side at export — Week B.',
    state.deck.watermark !== false, async (on) => {
      state.deck.watermark = on;
      await show($('#preview'), state.deck, state.index);
      refreshAllThumbs();
      revalidate();
    }));

  host.appendChild(toggleRow('Page numbers', 'The 1/7 label in the footer.',
    Boolean(state.deck.slides[0]?.page_label), async (on) => {
      const n = state.deck.slides.length;
      state.deck.slides.forEach((s, i) => {
        if (on) s.page_label = `${i + 1}/${n}`;
        else delete s.page_label;
      });
      await show($('#preview'), state.deck, state.index);
      refreshAllThumbs();
      revalidate();
    }));
}

function toggleRow(title, sub, on, onChange) {
  const row = document.createElement('div');
  row.className = 'switchrow';
  const text = document.createElement('div');
  const t = document.createElement('span');
  t.textContent = title;
  const s = document.createElement('small');
  s.textContent = sub;
  text.append(t, s);
  const btn = document.createElement('button');
  btn.className = 'sw-toggle' + (on ? ' on' : '');
  btn.innerHTML = '<i></i>';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', String(on));
  btn.onclick = () => {
    const next = !btn.classList.contains('on');
    btn.classList.toggle('on', next);
    btn.setAttribute('aria-checked', String(next));
    onChange(next);
  };
  row.append(text, btn);
  return row;
}

// --------------------------------------------------------------- brand tab
function brandFromInputs() {
  const name = $('#b-name')?.value.trim();
  const handle = $('#b-handle')?.value.trim();
  if (!name && !handle) return undefined;
  return { ...(name ? { name } : {}), ...(handle ? { handle } : {}) };
}

function buildBrandTab() {
  const host = $('#tabBrand');
  const caps = state.meta.caps;
  const brand = state.deck.brand ?? {};
  host.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'subhead';
  head.textContent = 'Footer';
  host.appendChild(head);

  for (const [key, labelText, cap] of [
    ['name', 'Name', caps.brand_name],
    ['handle', 'Handle', caps.brand_handle],
  ]) {
    const value = brand[key] ?? '';
    const { wrap, cnt } = fieldShell(`b-${key}`, labelText, value.length, cap);
    const input = document.createElement('input');
    input.id = `b-${key}`;
    input.maxLength = cap;
    input.value = value;
    input.oninput = async () => {
      state.deck.brand = state.deck.brand ?? {};
      if (input.value.trim()) state.deck.brand[key] = input.value;
      else delete state.deck.brand[key];
      if (!Object.keys(state.deck.brand).length) delete state.deck.brand;
      cnt.textContent = `${input.value.length}/${cap}`;
      cnt.className = `cnt ${capClass(input.value.length, cap)}`;
      refreshPreview();
      refreshThumb(state.index);
      revalidate();
    };
    wrap.appendChild(input);
    host.appendChild(wrap);
  }

  const why = document.createElement('p');
  why.className = 'why';
  why.textContent =
    'Week B moves this to a brands table so it is set once and reused. Today it lives on the deck.';
  host.appendChild(why);
}

// ------------------------------------------------------------- validation
/**
 * The authoritative check is the server's: same Ajv instance, same lint, same
 * schema. Re-implementing either in the browser would be two things to keep in
 * agreement, and they would stop agreeing.
 */
const revalidate = debounce(async () => {
  if (!state.deck) return;
  const r = await api('/api/validate', { deck: state.deck });
  if (!r.ok) return;
  state.errors = r.errors ?? [];
  state.warnings = r.warnings ?? [];

  const pill = $('#vstate');
  pill.className = 'vstate ' + (state.errors.length ? 'bad' : state.warnings.length ? 'warn' : 'ok');
  pill.textContent = state.errors.length
    ? `${state.errors.length} error${state.errors.length > 1 ? 's' : ''}`
    : state.warnings.length
      ? `${state.warnings.length} warning${state.warnings.length > 1 ? 's' : ''}`
      : 'valid';

  // Refresh only the warnings block, so typing never steals focus from a field.
  const host = $('#tabContent');
  $$('.subhead', host).filter((h) => /Schema errors|Worth a look/.test(h.textContent)).forEach((h) => h.remove());
  $$('.warnlist', host).forEach((l) => l.remove());
  renderWarnings(host);
}, 450);

// ----------------------------------------------------------------- rendering
async function renderPngs() {
  const btn = $('#renderBtn');
  btn.disabled = true;
  $('.label', btn).textContent = 'Rendering…';

  const r = await api('/api/render', { deck: state.deck });

  btn.disabled = false;
  $('.label', btn).textContent = 'Render PNGs';

  if (!r.ok) {
    $('#stageNote').textContent = `Render failed — ${r.message}`;
    return;
  }
  $('#sheetTitle').textContent = `${r.count} PNGs written`;
  $('#sheetSub').textContent =
    `${r.dir}/ · 1080×1350 each · ${r.seconds}s${r.notes?.length ? ` · ${r.notes.join('; ')}` : ''}`;
  const shots = $('#shots');
  shots.innerHTML = '';
  for (const url of r.urls) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    const img = document.createElement('img');
    img.src = url;
    img.alt = url.split('/').pop();
    img.loading = 'lazy';
    a.appendChild(img);
    shots.appendChild(a);
  }
  $('#sheet').hidden = false;
}

boot();
