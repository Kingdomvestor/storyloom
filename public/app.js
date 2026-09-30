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
  user: null,
  credits: null,
  plan: 'free',
  deckId: null,
  deck: null,
  index: 0,
  warnings: [],
  errors: [],
  dirty: false,
  defaultBrand: null,   // the user's default footer, applied to new decks
  brands: null,         // the brand library, loaded when the Brand tab first opens
  styleLibrary: [],
  isAdmin: false,
  compose: { src: 'text', slides: 'auto', narrative: 'listicle', style: 'signature-african', platform: 'linkedin' },
};

let sb = null; // supabase browser client, or null when unconfigured
let persistPromise = null;
let deckRevision = 0;

// ----------------------------------------------------------------- transport
async function api(path, body, opts = {}) {
  const method = opts.method ?? (body ? 'POST' : 'GET');
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (sb) {
      const { data } = attempt
        ? await sb.auth.refreshSession().catch(() => ({ data: null }))
        : await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers.authorization = `Bearer ${token}`;
    }
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    // `raw` is for the one response that isn't JSON: /api/export sends a file.
    // It still needs the Bearer token and the same one-shot refresh on 401, and
    // that logic should live in exactly one place.
    if (opts.raw) {
      if (res.status === 401 && sb && attempt === 0) continue;
      return res;
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, kind: 'bad_response', message: `${res.status} ${res.statusText}` };
    }
    if (data && data.ok === false && data.kind === 'unauthorized' && sb && attempt === 0) continue;
    if (data && data.ok === false && data.kind === 'unauthorized' && sb) {
      await sb.auth.signOut();
      await applySession(null, { navigate: true });
    }
    return data;
  }
}

// ------------------------------------------------------------------ accounts
async function initSupabase(cfg) {
  if (!cfg) return null;                        // unconfigured server → stay null
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(cfg.url, cfg.anonKey);
  return sb;
}

function setAuthMessage(text, { error = false } = {}) {
  const msg = $('#authMsg');
  const err = $('#authErr');
  msg.hidden = true;
  err.hidden = true;
  const node = error ? err : msg;
  node.textContent = text;
  node.hidden = false;
}

/** Single source of truth for "who is signed in" → drives the view + header. */
async function applySession(session, { navigate = true } = {}) {
  state.user = session?.user ?? null;
  document.documentElement.dataset.auth = state.user ? 'in' : 'out';
  $('#brandHome').href = state.user ? '/studio' : '/';
  if (!state.user) {
    state.credits = null;
    state.deckId = null;
    if (navigate) document.documentElement.dataset.view = 'auth';
    return;
  }
  $('#userEmail').textContent = state.user.email;
  await loadDashboard();                        // sets credits + grid
  if (sb) await loadStyleLibrary();
  if (state.user && navigate) document.documentElement.dataset.view = 'dashboard';
}

function renderCredits() {
  if (state.credits == null) return;
  $('#creditsNum').textContent = state.credits;
  const btn = $('#generateBtn');
  const out = state.credits <= 0;
  // don't override the no-API-key disable
  if (state.meta?.hasApiKey) btn.disabled = out;
  $('.cost', btn).textContent = out ? 'no credits' : '1 credit';
}

async function handleAuthEvent(event, session) {
  if (event === 'SIGNED_OUT') {
    await applySession(null, { navigate: true });
    return;
  }

  if (!session?.user) {
    await applySession(null, { navigate: document.documentElement.dataset.view === 'auth' });
    return;
  }

  const wasSignedOut = !state.user;
  await applySession(session, { navigate: wasSignedOut || document.documentElement.dataset.view === 'auth' });
}

function wireAuth() {
  const form = $('#authForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!sb) return;
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    $('#authErr').hidden = true;
    $('#authMsg').hidden = true;
    $('#authSubmit').disabled = true;
    const mode = form.dataset.mode;
    const { data, error } = mode === 'signup'
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });
    $('#authSubmit').disabled = false;
    if (error) {
      setAuthMessage(error.message, { error: true });
      return;
    }
    if (data?.session) {
      await applySession(data.session);
      return;
    }
    if (mode === 'signup') {
      setAuthMessage('Account created. Check your email to confirm it, then sign in.');
    }
    // success → onAuthStateChange fires applySession → dashboard
  };
  $('#authToggle').onclick = () => {
    const to = form.dataset.mode === 'signin' ? 'signup' : 'signin';
    form.dataset.mode = to;
    $('#authErr').hidden = true;
    $('#authMsg').hidden = true;
    $('#authSubmit').textContent = to === 'signup' ? 'Create account' : 'Sign in';
    $('#authToggle').textContent = to === 'signup'
      ? 'Have an account? Sign in' : 'New here? Create an account';
    $('#authPassword').autocomplete = to === 'signup' ? 'new-password' : 'current-password';
  };
  $('#logoutBtn').onclick = async () => {
    if (state.deck && state.dirty && state.user) {
      const r = await persist();
      if (!r.ok) {
        $('#stageNote').textContent = `Sign out paused — save failed: ${r.message}`;
        scheduleAutosaveRetry(r.message);
        return;
      }
    }
    await sb?.auth.signOut();
  };
  $('#brandHome').onclick = async (event) => {
    if (!state.user) return;
    event.preventDefault();
    if (state.deck && state.dirty) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      const r = await persist();
      if (!r.ok) {
        $('#stageNote').textContent = `Cannot leave yet — save failed: ${r.message}`;
        scheduleAutosaveRetry(r.message);
        return;
      }
    }
    await applySession({ user: state.user });
  };
  $('#dashLink').onclick = async () => {
    if (state.deck && state.dirty && state.user) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      const r = await persist();
      if (!r.ok) {
        $('#stageNote').textContent = `Cannot leave yet — save failed: ${r.message}`;
        scheduleAutosaveRetry(r.message);
        return;
      }
    }
    await applySession({ user: state.user });
  };
}

async function loadDashboard() {
  const r = await api('/api/decks');
  const empty = $('#dashEmpty');
  const grid = $('#deckGrid');
  if (!r.ok) {
    grid.innerHTML = '';
    empty.classList.add('error');
    empty.hidden = false;
    empty.textContent = `Could not load decks: ${r.message}`;
    return;
  }
  state.credits = r.credits;
  state.plan = r.plan ?? 'free';
  state.defaultBrand = r.defaultBrand ?? null;
  renderCredits();
  grid.innerHTML = '';
  empty.classList.remove('error');
  empty.textContent = 'No saved carousels yet. Create one with AI or start from a free template.';
  empty.hidden = r.decks.length > 0;
  for (const d of r.decks) grid.appendChild(deckCard(d));
}

function deckCard(d) {
  const card = document.createElement('article');
  card.className = 'deckcard';

  const heading = document.createElement('h2');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'deck-open';
  open.setAttribute('aria-label', `Open ${d.title || 'Untitled'}`);
  open.onclick = () => openSavedDeck(d.id);
  const title = document.createElement('span');
  title.className = 'deck-open-title';
  title.textContent = d.title || 'Untitled';
  const openLabel = document.createElement('span');
  openLabel.className = 'deck-open-cta';
  openLabel.textContent = 'Open carousel';
  open.append(title, openLabel);
  heading.appendChild(open);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const badge = document.createElement('span');
  badge.className = 'badge-source';
  badge.dataset.src = d.source;
  badge.textContent = d.source === 'ai' ? 'AI generated' : 'Template';
  const when = document.createElement('span');
  const updatedAt = new Date(d.updated_at);
  when.textContent = Number.isNaN(updatedAt.getTime())
    ? ''
    : `Edited ${updatedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  meta.append(badge, when);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'linkbtn del';
  del.setAttribute('aria-label', `Delete ${d.title || 'Untitled'}`);
  del.title = `Delete ${d.title || 'Untitled'}`;
  del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg>';
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${d.title || 'Untitled'}"?`)) return;
    const r = await api('/api/decks/' + d.id, null, { method: 'DELETE' });
    if (r.ok) await loadDashboard();
    else {
      const empty = $('#dashEmpty');
      empty.classList.add('error');
      empty.hidden = false;
      empty.textContent = `Could not delete deck: ${r.message}`;
    }
  };

  const footer = document.createElement('div');
  footer.className = 'deckcard-foot';
  footer.append(meta, del);
  card.append(heading, footer);
  return card;
}

async function openSavedDeck(id) {
  const r = await api('/api/decks/' + id);
  if (!r.ok) return;
  openEditor(r.deck, { deckId: id });
}

function wireDashboard() {
  $('#newDeckBtn').onclick = () => {
    state.deckId = null;
    document.documentElement.dataset.view = 'compose';
    showNewDeckChoice();
  };
}

/** The one write path to the deck store, shared by the Save button and autosave. */
async function persist() {
  if (persistPromise) return persistPromise;

  const pending = (async () => {
    let r;
    do {
      const revision = deckRevision;
      const deck = structuredClone(state.deck);
      const payload = { title: deck.title || 'Untitled', deck };
      const id = state.deckId;
      try {
        r = id
          ? await api('/api/decks/' + id, payload, { method: 'PUT' })
          : await api('/api/decks', payload);
      } catch (error) {
        return { ok: false, message: error.message || 'Network request failed.' };
      }
      if (!r.ok) return r;
      state.deckId = r.id ?? state.deckId;
      state.dirty = deckRevision !== revision;
    } while (state.dirty);
    return r;
  })();
  persistPromise = pending;
  try {
    return await pending;
  } finally {
    if (persistPromise === pending) persistPromise = null;
  }
}

async function saveDeck() {
  const btn = $('#saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const r = await persist();
  btn.disabled = false; btn.textContent = 'Save';
  if (!r.ok) {
    $('#stageNote').textContent = `Save failed — ${r.message}`;
    scheduleAutosaveRetry(r.message);
    return;
  }
  btn.textContent = 'Saved ✓';
  setAutoState('saved');
  setTimeout(() => (btn.textContent = 'Save'), 1500);
}

// --------------------------------------------------------- autosave + history

const AUTOSAVE_MS = 2000;   // after the last edit, not on a fixed clock
const COALESCE_MS = 900;    // edits closer together than this are one undo step
const HISTORY_MAX = 60;

function setAutoState(kind, text) {
  const el = $('#autostate');
  if (!el) return;
  el.className = `autostate ${kind}`;
  const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el.textContent = text ?? (kind === 'saved' ? `Saved ${clock}` : '');
}

let autosaveTimer = null;
let autosaveFailures = 0;

function scheduleAutosaveRetry(message) {
  const retryMs = Math.min(60000, 5000 * 2 ** autosaveFailures++);
  setAutoState('failed', `Save failed: ${message}. Retrying in ${Math.ceil(retryMs / 1000)}s`);
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, retryMs);
}

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty || !state.user) return;
  event.preventDefault();
  event.returnValue = '';
});

/**
 * Every deck mutation lands here (see revalidate). Two things follow from an
 * edit: it belongs in the undo stack, and it should end up on the server without
 * anyone pressing Save. The dirty flag is what keeps template *browsing* from
 * creating rows — nothing is written until the user actually changes something.
 */
function markDirty() {
  if (!state.deck) return;
  autosaveFailures = 0;
  deckRevision++;
  state.dirty = true;
  if (!state.user) return;   // degraded / signed out: nowhere to autosave to
  setAutoState('pending', 'Unsaved…');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, AUTOSAVE_MS);
}

async function autosave() {
  if (!state.dirty || !state.user || !state.deck) return;
  // A deck with schema errors would be rejected by the server's validator, so
  // there is no point spending the round trip. The next edit reschedules this,
  // and fixing the error *is* an edit.
  if (state.errors.length) return setAutoState('pending', 'Fix errors to save');
  setAutoState('pending', 'Saving…');
  const r = await persist();
  if (r.ok) {
    autosaveFailures = 0;
    setAutoState('saved');
    return;
  }
  scheduleAutosaveRetry(r.message);
}

/**
 * Undo/redo over whole-deck JSON snapshots.
 *
 * Snapshotting the entire deck rather than diffing it is the right trade at this
 * size — a deck is ~6KB, and a patch-based stack would have to know about every
 * field the editor can touch, which is precisely the coupling that rots.
 *
 * `base` is the state as it stands now; `past` holds what came before it. A burst
 * of keystrokes collapses into one entry, so Ctrl+Z undoes a word, not a letter.
 */
const history = { past: [], future: [], base: null, at: 0 };
const snapshot = () => JSON.stringify(state.deck);

function resetHistory() {
  history.past.length = 0;
  history.future.length = 0;
  history.base = state.deck ? snapshot() : null;
  history.at = 0;
  paintHistory();
}

function pushHistory() {
  if (!state.deck) return;
  const current = snapshot();
  if (current === history.base) return;   // a keystroke that changed nothing
  const now = Date.now();
  if (now - history.at > COALESCE_MS) {
    history.past.push(history.base);
    if (history.past.length > HISTORY_MAX) history.past.shift();
  }
  history.base = current;
  history.at = now;
  history.future.length = 0;              // a new edit abandons the redo branch
  paintHistory();
}

function paintHistory() {
  const undoBtn = $('#undoBtn');
  const redoBtn = $('#redoBtn');
  if (!undoBtn) return;
  undoBtn.disabled = history.past.length === 0;
  redoBtn.disabled = history.future.length === 0;
}

function restoreSnapshot(json) {
  state.deck = JSON.parse(json);
  state.index = Math.min(state.index, state.deck.slides.length - 1);
  buildRail();
  buildStyleTab();
  buildBrandTab();
  buildAiTab();
  selectSlide(state.index);
  markDirty();      // an undone deck is still a deck the server hasn't got
  runValidate();    // not revalidate(): restoring must not push a history entry
  paintHistory();
}

function undo() {
  if (!history.past.length) return;
  history.future.push(history.base);
  history.base = history.past.pop();
  restoreSnapshot(history.base);
}

function redo() {
  if (!history.future.length) return;
  history.past.push(history.base);
  history.base = history.future.pop();
  restoreSnapshot(history.base);
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

  const modelName = $('#modelName');
  if (modelName) modelName.textContent = meta.hasApiKey ? meta.model : 'no key';
  if (!meta.hasApiKey) {
    $('#modelPill')?.classList.add('off');
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

  if (sb) {
    await loadStyleLibrary();
  }

  wireCompose();
  wireEditor();
  wireAuth();
  wireDashboard();

  await initSupabase(meta.supabase);
  if (!sb) {
    // No accounts configured — degrade to today's single-user behavior, but
    // make the reason discoverable if someone lands on the auth view.
    $('#authNotice').hidden = false;
    $('#brandHome').href = '/';
    document.documentElement.dataset.auth = 'out';
    document.documentElement.dataset.view = 'compose';
    loadGallery();                 // templates are the whole app in degraded mode
    return;
  }
  sb.auth.onAuthStateChange((event, session) => handleAuthEvent(event, session));
  const { data } = await sb.auth.getSession();
  applySession(data?.session ?? null);
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
async function loadStyleLibrary() {
  if (!sb) return;
  const r = await api('/api/styles');
  if (!r.ok) return;
  state.isAdmin = Boolean(r.isAdmin);
  state.styleLibrary = Array.isArray(r.styles) ? r.styles : [];
  const styles = [...new Set([...(state.meta?.styles ?? []), ...state.styleLibrary.map((s) => s.slug || s.id)])];
  if (state.meta) state.meta.styles = styles;
  buildStylePicker();
  if (document.documentElement.dataset.view === 'editor' && state.deck) buildStyleTab();
}

function buildStylePicker() {
  const host = $('#stylePicker');
  if (!host || !state.meta) return;
  const styles = Array.isArray(state.meta.styles) ? state.meta.styles : [];
  host.innerHTML = '';
  for (const s of styles) {
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
function showNewDeckChoice() {
  const choice = $('#newDeckChoice');
  const composer = $('#composer');
  const gallery = $('#gallery');
  if (!choice || !composer || !gallery) return;
  choice.hidden = false;
  composer.hidden = true;
  gallery.hidden = true;
}

function beginNewDeckChoice(mode) {
  const choice = $('#newDeckChoice');
  const composer = $('#composer');
  const gallery = $('#gallery');
  if (!choice || !composer || !gallery) return;
  choice.hidden = true;
  if (mode === 'template') {
    composer.hidden = true;
    gallery.hidden = false;
    loadGallery();
    return;
  }
  composer.hidden = false;
  gallery.hidden = true;
  $('#sourceText').focus();
}

function wireCompose() {
  $$('#newDeckChoice [data-start-mode]').forEach((b) => {
    b.onclick = () => beginNewDeckChoice(b.dataset.startMode);
  });
  $('#newDeckBack').onclick = async () => {
    if (state.user) {
      document.documentElement.dataset.view = 'dashboard';
      await loadDashboard();
      return;
    }
    document.documentElement.dataset.view = 'auth';
  };

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

/**
 * A `kind` is for the server log; a human needs to know whose problem it is and
 * what to do next. Anything missing here falls back to "Could not generate" —
 * which is still better than printing `http_error:` at someone.
 */
const ERROR_LABELS = {
  overloaded: 'The model is busy',
  no_credits: 'Out of credits',
  unauthorized: 'Sign in to continue',
  no_input: 'Nothing to work with',
  no_api_key: 'Not configured',
  bad_url: 'That link looks wrong',
  unsupported_protocol: 'That link looks wrong',
  blocked_host: 'That link is not allowed',
  not_html: 'That link is not an article',
  no_article: 'Nothing readable on that page',
  too_thin: 'Too little text on that page',
  fetch_error: 'Could not reach that page',
  too_many_redirects: 'Could not reach that page',
  parse_error: 'Could not read that page',
  network_error: 'Could not reach the model',
  empty_response: 'The model returned nothing',
  blocked: 'The model refused the prompt',
  truncated: 'The response was cut off',
  unrepairable: 'Could not build a valid deck',
  http_error: 'The model rejected the request',
  render_error: 'Could not render the slides',
  server_error: 'Something broke on the server',
};
const errorLabel = (kind) => ERROR_LABELS[kind] ?? 'Could not generate';

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
    // Your saved default, if you have one. A deck that comes back brandless still
    // gets it applied in openEditor — this is so the model can see the handle.
    brand: state.defaultBrand ?? undefined,
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
    // The server refunds on failure and sends the balance back with the error, so
    // the pill agrees with the ledger without a reload.
    if (typeof result.credits === 'number') { state.credits = result.credits; renderCredits(); }
    err.hidden = false;
    err.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = `${errorLabel(result.kind)}: `;
    err.appendChild(b);
    err.appendChild(document.createTextNode(result.message));
    if (result.notes?.includes('credit refunded')) {
      const small = document.createElement('small');
      small.textContent = ' Your credit was refunded.';
      err.appendChild(small);
    }
    return;
  }
  if (typeof result.credits === 'number') { state.credits = result.credits; renderCredits(); }
  openEditor(result.deck, { ...result, autoSave: true });
}

// ---------------------------------------------------------------- gallery (B)
async function loadGallery() {
  const r = await api('/api/templates');
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
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  deckRevision = 0;
  $('#backBtn').disabled = false;
  state.deck = deck;
  state.index = 0;
  state.deckId = info.deckId ?? null;
  state.dirty = false;
  document.documentElement.dataset.view = 'editor';

  // A new deck inherits the default brand; a saved one never does. Re-applying it
  // on open would resurrect a footer the user deliberately cleared three edits ago.
  if (!info.deckId && !deck.brand && state.defaultBrand) deck.brand = { ...state.defaultBrand };

  $('#deckTitle').value = deck.title ?? '';
  const src = $('#deckSource');
  src.textContent = deck.source === 'ai' ? 'AI generated' : 'Template';
  src.dataset.src = deck.source;

  const note = $('#stageNote');
  note.textContent = info.degraded
    ? 'This deck needed repairing — some text was truncated to fit. Worth a read before you post it.'
    : 'Click any text on the slide to edit it in place.';

  buildRail();
  buildStyleTab();
  buildBrandTab();
  buildAiTab();
  selectSlide(0);
  fitStage();
  resetHistory();
  setAutoState('', '');
  revalidate({ passive: true });   // opening a deck is not an edit of it
  if (info.autoSave) markDirty();
}

function wireEditor() {
  $('#backBtn').onclick = async () => {
    const back = $('#backBtn');
    back.disabled = true;
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (state.dirty && state.user) {
      setAutoState('pending', 'Saving before leaving…');
      const r = await persist();
      if (!r.ok) {
        $('#stageNote').textContent = `Cannot leave yet — save failed: ${r.message}`;
        scheduleAutosaveRetry(r.message);
        back.disabled = false;
        return;
      }
    }
    state.deckId = null;
    document.documentElement.dataset.view = state.user ? 'dashboard' : 'compose';
    if (state.user) loadDashboard();
  };
  $('#prevSlide').onclick = () => selectSlide(state.index - 1);
  $('#nextSlide').onclick = () => selectSlide(state.index + 1);
  $('#saveBtn').onclick = saveDeck;
  $('#renderBtn').onclick = renderPngs;
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#sheetX').onclick = () => ($('#sheet').hidden = true);
  $('#sheet').onclick = (e) => { if (e.target === $('#sheet')) $('#sheet').hidden = true; };
  wireCanvas($('#preview'));

  // Download menu. Closing on any outside click is wired on document, not on a
  // backdrop element: a backdrop would swallow the first click on everything else.
  const pop = $('#exportPop');
  $('#exportBtn').onclick = (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    $('#exportBtn').setAttribute('aria-expanded', String(open));
  };
  $$('#exportPop button').forEach((b) => {
    b.onclick = () => exportDeck(b.dataset.format);
  });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !$('#exportMenu').contains(e.target)) {
      pop.hidden = true;
      $('#exportBtn').setAttribute('aria-expanded', 'false');
    }
  });

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

    // Ctrl+Z is intercepted even inside a text field. The browser's own per-field
    // undo and the deck-level stack would otherwise disagree about what the last
    // change was, and the user would get whichever one happened to have focus.
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveDeck(); return; }

    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
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
    thumb.draggable = true;
    thumb.dataset.index = String(i);
    // The .shield sits over the iframe so a drag grabs the thumb, not the
    // pointer-events:none iframe underneath. It's inert until a drag starts.
    thumb.innerHTML = `<iframe src="/templates/carousel.html" scrolling="no" tabindex="-1"></iframe><span class="shield"></span><span class="n"></span>`;
    $('.n', thumb).textContent = String(i + 1);
    thumb.onclick = () => selectSlide(i);
    wireThumbDrag(thumb, rail);
    rail.appendChild(thumb);
    scaleFrame(thumb, $('iframe', thumb), width);
    show($('iframe', thumb), state.deck, i);
  });

  buildRailFoot(rail);
}

/**
 * Rail footer: add, remove, and the count that explains why either disables.
 * Bounds come from the schema through /api/meta, so the rail cannot take the
 * deck outside slides.minItems…maxItems in the first place.
 */
function buildRailFoot(rail) {
  const { min, max } = state.meta.slides;
  const n = state.deck.slides.length;

  const foot = document.createElement('div');
  foot.className = 'railfoot';
  foot.innerHTML =
    '<button class="rbtn" data-act="add" aria-label="Add slide">+</button>'
    + '<button class="rbtn" data-act="del" aria-label="Remove the selected slide">−</button>'
    + `<span class="rcount">${n}/${max}</span>`;

  const add = $('[data-act="add"]', foot);
  const del = $('[data-act="del"]', foot);
  add.disabled = n >= max;
  del.disabled = n <= min;
  add.title = add.disabled ? `${max} slides is the schema maximum.` : 'Add a slide before the CTA';
  del.title = del.disabled ? `${min} slides is the schema minimum.` : 'Remove the selected slide';
  add.onclick = addSlide;
  del.onclick = () => removeSlide(state.index);

  rail.appendChild(foot);
}

/**
 * HTML5 drag-and-drop for one rail thumb. The rail gets a `dragging` class for
 * the duration so .shield overlays go live (see app.css) and the iframes stop
 * swallowing the drag. Index is read from dataset at drop time, not closure,
 * so it survives a rebuild.
 */
function wireThumbDrag(thumb, rail) {
  thumb.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', thumb.dataset.index);
    rail.classList.add('dragging');
    thumb.classList.add('drag-src');
  });
  thumb.addEventListener('dragend', () => {
    rail.classList.remove('dragging');
    $$('.rthumb').forEach((t) => t.classList.remove('drag-src', 'drag-over'));
  });
  thumb.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    thumb.classList.add('drag-over');
  });
  thumb.addEventListener('dragleave', () => thumb.classList.remove('drag-over'));
  thumb.addEventListener('drop', (e) => {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData('text/plain'));
    const to = Number(thumb.dataset.index);
    // buildRail() detaches the drag source, so dragend is not guaranteed to
    // fire — drop the class here or the shields stay live over a dead drag.
    rail.classList.remove('dragging');
    moveSlide(from, to);
  });
}

/**
 * Slot 0 is the hook, the last slot is the cta, everything between is body.
 * Every structural edit re-derives type from position rather than trying to
 * carry it along — the same rule repairDeck() applies in src/validate.js, so a
 * rearranged deck always validates.
 */
function retypeSlides() {
  const slides = state.deck.slides;
  const last = slides.length - 1;
  slides.forEach((s, i) => { s.type = i === 0 ? 'hook' : i === last ? 'cta' : 'body'; });
}

/** Move a slide from one slot to another, then re-derive every type. */
function moveSlide(from, to) {
  const slides = state.deck.slides;
  if (from === to || from < 0 || to < 0 || from >= slides.length || to >= slides.length) return;
  const [moved] = slides.splice(from, 1);
  slides.splice(to, 0, moved);
  retypeSlides();
  buildRail();
  selectSlide(to);
  revalidate();
}

/**
 * Insert a blank body slide *before* the cta, never at the end. Types are
 * derived from position, so appending would demote the author's closing slide to
 * a body and promote this placeholder into the cta slot.
 */
function addSlide() {
  const slides = state.deck.slides;
  if (slides.length >= state.meta.slides.max) return;
  const at = Math.max(1, slides.length - 1);
  slides.splice(at, 0, { type: 'body', heading: `Point ${at}`, body: 'Add your point here.' });
  retypeSlides();
  buildRail();
  selectSlide(at);
  revalidate();
}

/** Remove one slide, then re-derive types — a neighbour inherits hook or cta. */
function removeSlide(i) {
  const slides = state.deck.slides;
  if (slides.length <= state.meta.slides.min || i < 0 || i >= slides.length) return;
  slides.splice(i, 1);
  retypeSlides();
  buildRail();
  selectSlide(Math.min(i, slides.length - 1));
  revalidate();
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

// ------------------------------------------------ click-to-edit on the canvas
/**
 * The preview iframe is same-origin (it is served from /templates/carousel.html),
 * so the editor can reach in and make one block editable where it sits. Every
 * text block already renders with `data-field` naming the deck field it came
 * from, so this needs no second copy of the layout and no coordinate maths.
 *
 * Nothing is added to the template file: the affordance CSS is injected from
 * here at runtime, so Puppeteer — which loads that same file from disk — never
 * sees it. `color-mix` on currentColor means the outline reads on the bone skin
 * and the near-black one without either being told which is which.
 */
const CANVAS_CSS = `
  [data-field] { cursor: text; }
  [data-field]:hover, [data-field][data-editing] {
    outline: 2px dashed color-mix(in srgb, currentColor 34%, transparent);
    outline-offset: 12px; border-radius: 4px;
  }
  [data-field][data-editing] { outline-style: solid; }
`;

/** field path → the schema cap that governs it, from /api/meta. */
function capForField(path) {
  const caps = state.meta.caps;
  if (path.startsWith('bullets.')) return caps.bullet;
  if (path === 'cta.label') return caps.cta;
  return caps[path] ?? 200;
}

function readCanvasField(path) {
  const s = state.deck.slides[state.index];
  if (path.startsWith('bullets.')) return s.bullets?.[Number(path.slice(8))] ?? '';
  if (path === 'cta.label') return s.cta?.label ?? '';
  return s[path] ?? '';
}

/**
 * Write a canvas edit back. Empty is meaningful and matches the panel: clearing
 * an optional field deletes it, clearing a bullet removes the row, and clearing
 * the heading leaves it empty for the validator to complain about rather than
 * silently dropping a required field.
 */
function writeCanvasField(path, text) {
  const s = state.deck.slides[state.index];
  if (path.startsWith('bullets.')) {
    const i = Number(path.slice(8));
    if (!Array.isArray(s.bullets) || i >= s.bullets.length) return false;
    if (text) s.bullets[i] = text;
    else {
      s.bullets.splice(i, 1);
      if (!s.bullets.length) delete s.bullets;
    }
    return true;
  }
  if (path === 'cta.label') {
    if (!s.cta) return false;
    if (text) s.cta.label = text;
    else return false;                 // an unlabelled pill is not a thing; keep it
    return true;
  }
  if (!TEXT_FIELD_KEYS.has(path)) return false;
  if (text || path === 'heading') s[path] = text;
  else delete s[path];
  return true;
}

const TEXT_FIELD_KEYS = new Set(TEXT_FIELDS.map((f) => f.key));

/**
 * The highlight spans inside the block are left alone while typing: the commit
 * reads textContent, and the re-render rebuilds them from `highlight_words`
 * anyway, so any DOM the editing left behind is discarded a frame later. Not
 * rewriting the content up front is also what lets the caret land where the
 * click did instead of jumping to the end.
 */
function startCanvasEdit(el, path, point) {
  const doc = el.ownerDocument;
  const cap = capForField(path);
  const original = readCanvasField(path);
  let cancelled = false;

  el.dataset.editing = '1';
  el.spellcheck = false;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'; // older Chrome
  el.focus({ preventScroll: true });

  const caret = point && doc.caretRangeFromPoint?.(point.x, point.y);
  const sel = doc.getSelection();
  if (sel) {
    sel.removeAllRanges();
    if (caret) sel.addRange(caret);
    else {
      const r = doc.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.addRange(r);
    }
  }

  // The panel's inputs get maxLength; this is the same rule, enforced at the one
  // point where text arrives — typing, pasting or dropping.
  const onBefore = (e) => {
    const incoming = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    if (!incoming) return;
    const s2 = doc.getSelection();
    const replacing = s2 && !s2.isCollapsed ? String(s2).length : 0;
    if (el.textContent.length - replacing + incoming.length > cap) e.preventDefault();
  };

  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; el.blur(); }
  };

  const onBlur = () => {
    el.removeEventListener('beforeinput', onBefore);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    delete el.dataset.editing;
    el.contentEditable = 'inherit';
    finishCanvasEdit(path, cancelled ? original : el.textContent, original);
  };

  el.addEventListener('beforeinput', onBefore);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
}

function finishCanvasEdit(path, raw, original) {
  // Newlines can only arrive by paste (Enter commits), and no deck field renders
  // one — fold them into spaces rather than storing text the canvas won't show.
  const text = String(raw).replace(/\s*\n+\s*/g, ' ').trim().slice(0, capForField(path));
  if (text === original) return refreshPreview();   // repaints the highlight spans
  if (!writeCanvasField(path, text)) return refreshPreview();
  buildContentTab();
  show($('#preview'), state.deck, state.index);     // now, not debounced
  refreshThumb(state.index);
  revalidate({ discrete: true });
}

/** Attach once per iframe document; re-attaches if the frame ever reloads. */
function wireCanvas(iframe) {
  const attach = () => {
    const doc = iframe.contentDocument;
    if (!doc || doc.__storyloomEdit) return;
    doc.__storyloomEdit = true;
    const style = doc.createElement('style');
    style.textContent = CANVAS_CSS;
    doc.head.appendChild(style);
    doc.addEventListener('mousedown', (e) => {
      const el = e.target.closest?.('[data-field]');
      if (!el || el.dataset.editing) return;
      e.preventDefault();            // no drag-select of the whole card
      startCanvasEdit(el, el.dataset.field, { x: e.clientX, y: e.clientY });
    });
  };
  iframe.addEventListener('load', attach);
  attach();
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
  if (!host || !state.meta) return;
  host.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'subhead';
  head.textContent = 'Skin';
  host.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'styles';
  const styles = Array.isArray(state.meta.styles) ? state.meta.styles : [];
  for (const s of styles) {
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
      const selectedStyle = state.styleLibrary.find((style) => (style.slug || style.id) === s);
      state.deck.style_id = s;
      if (selectedStyle && !selectedStyle.is_system) state.deck.theme = structuredClone(selectedStyle.settings || {});
      else delete state.deck.theme;
      selectOne($$('.stylecard', grid), card);
      await show($('#preview'), state.deck, state.index);
      refreshAllThumbs();
    };
    grid.appendChild(card);
  }
  host.appendChild(grid);

  if (state.isAdmin) {
    const adminWrap = document.createElement('div');
    adminWrap.className = 'style-admin';

    const adminHead = document.createElement('div');
    adminHead.className = 'subhead';
    adminHead.textContent = 'Custom styles';
    adminWrap.appendChild(adminHead);

    const library = document.createElement('div');
    library.className = 'style-library';
    const saved = Array.isArray(state.styleLibrary) ? state.styleLibrary : [];
    if (!saved.length) {
      const empty = document.createElement('div');
      empty.className = 'style-library-empty';
      empty.textContent = 'No published styles yet. Create the first one below.';
      library.appendChild(empty);
    } else {
      for (const style of saved) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'style-library-item';
        item.innerHTML = `
          <span class="style-swatch" style="--style-bg:${style.settings?.background_hex || '#0f172a'}; --style-accent:${style.settings?.accent_hex || '#d7a35f'}; --style-fg:${style.settings?.foreground_hex || '#f7f3ee'}"></span>
          <span class="style-copy">
            <strong>${(style.name || style.slug || 'Custom style').replace(/-/g, ' ')}</strong>
            <small>${style.slug || style.id}</small>
          </span>
        `;
        item.onclick = async () => {
          state.deck.style_id = style.slug || style.id;
          state.deck.theme = style.settings || {};
          await show($('#preview'), state.deck, state.index);
          refreshAllThumbs();
        };
        library.appendChild(item);
      }
    }
    adminWrap.appendChild(library);

    const form = document.createElement('form');
    form.className = 'style-form';
    form.innerHTML = `
      <div class="style-form-grid">
        <label>Name<input name="name" placeholder="Warm editorial" required /></label>
        <label>Slug<input name="slug" placeholder="warm-editorial" required /></label>
      </div>
      <div class="style-form-grid compact">
        <label>Background<input name="background_hex" type="color" value="#0f172a" /></label>
        <label>Surface<input name="surface_hex" type="color" value="#1f2937" /></label>
        <label>Foreground<input name="foreground_hex" type="color" value="#f8fafc" /></label>
        <label>Accent<input name="accent_hex" type="color" value="#d7a35f" /></label>
      </div>
      <label>Font family<input name="font_pair" value="Poppins, sans-serif" /></label>
      <button type="submit" class="btn-go sm">Publish style</button>
    `;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {
        name: String(fd.get('name') ?? '').trim(),
        slug: String(fd.get('slug') ?? '').trim(),
        status: 'published',
        settings: {
          background_hex: String(fd.get('background_hex') ?? '#0f172a'),
          surface_hex: String(fd.get('surface_hex') ?? '#1f2937'),
          foreground_hex: String(fd.get('foreground_hex') ?? '#f8fafc'),
          accent_hex: String(fd.get('accent_hex') ?? '#d7a35f'),
          font_pair: String(fd.get('font_pair') ?? 'Poppins, sans-serif').trim(),
        },
      };
      if (!body.name || !body.slug) return;
      const r = await api('/api/styles', body);
      if (!r.ok) {
        $('#stageNote').textContent = `Style save failed — ${r.message}`;
        return;
      }
      form.reset();
      await loadStyleLibrary();
      if (state.deck) {
        state.deck.style_id = r.style.slug || r.style.id || state.deck.style_id;
        state.deck.theme = r.style.settings || state.deck.theme || {};
        await show($('#preview'), state.deck, state.index);
        refreshAllThumbs();
      }
    };
    adminWrap.appendChild(form);

    const templateHead = document.createElement('div');
    templateHead.className = 'subhead';
    templateHead.textContent = 'Publish current deck as template';
    adminWrap.appendChild(templateHead);

    const templateForm = document.createElement('form');
    templateForm.className = 'style-form template-form';
    templateForm.innerHTML = `
      <label>Template name<input name="name" maxlength="60" placeholder="A name for the gallery" required /></label>
      <label>Slug<input name="slug" maxlength="40" placeholder="generated-from-name" /></label>
      <label>Description<textarea name="description" maxlength="220" rows="2"></textarea></label>
      <button type="submit" class="btn-go sm">Publish current deck</button>
    `;
    templateForm.onsubmit = async (e) => {
      e.preventDefault();
      const submit = $('button[type="submit"]', templateForm);
      const fd = new FormData(templateForm);
      const name = String(fd.get('name') ?? '').trim();
      const deck = structuredClone(state.deck);
      deck.title = name;
      deck.source = 'template';
      submit.disabled = true;
      try {
        const r = await api('/api/templates', {
          name,
          slug: String(fd.get('slug') ?? '').trim(),
          description: String(fd.get('description') ?? '').trim(),
          deck,
        });
        if (!r.ok) {
          $('#stageNote').textContent = `Template publish failed — ${r.message}`;
          return;
        }
        templateForm.reset();
        $('#stageNote').textContent = `Published “${r.template.name}” to the starter gallery.`;
      } catch (error) {
        $('#stageNote').textContent = `Template publish failed — ${error.message || 'Network request failed.'}`;
      } finally {
        submit.disabled = false;
      }
    };
    adminWrap.appendChild(templateForm);
    host.appendChild(adminWrap);
  }

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

  host.appendChild(toggleRow('Watermark',
    state.plan === 'pro'
      ? 'Yours to turn off — you are on Pro.'
      : 'On for free decks, and the export re-adds it if you switch it off here.',
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

  const lib = document.createElement('div');
  lib.className = 'brandlib';
  host.appendChild(lib);
  renderBrandLibrary(lib);

  const why = document.createElement('p');
  why.className = 'why';
  why.textContent = state.user
    ? 'The deck always carries its own footer — that is what renders. A saved brand is where you copy one from, so the next deck starts with it already filled in.'
    : 'Saved brands need an account. The footer above still renders; it just lives on this deck only.';
  host.appendChild(why);
}

/** The brand library: saved footers, and the two ways to add one. */
async function renderBrandLibrary(host) {
  if (!state.user) return;
  host.innerHTML = '<div class="subhead">Saved brands</div><p class="why">Loading…</p>';

  const rows = await loadBrands();
  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'subhead';
  head.textContent = 'Saved brands';
  host.appendChild(head);

  if (!rows.length) {
    const none = document.createElement('p');
    none.className = 'why';
    none.textContent = 'None yet.';
    host.appendChild(none);
  }
  for (const row of rows) host.appendChild(brandRow(row));

  const actions = document.createElement('div');
  actions.className = 'brandactions';
  actions.append(
    linkButton('Save footer as a brand', () => saveCurrentBrand(false)),
    linkButton('Save as my default', () => saveCurrentBrand(true))
  );
  host.appendChild(actions);
}

function linkButton(text, onClick) {
  const b = document.createElement('button');
  b.className = 'linkbtn';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function brandRow(b) {
  const row = document.createElement('div');
  row.className = 'brandrow' + (b.is_default ? ' isdefault' : '');

  const who = document.createElement('div');
  who.className = 'who';
  const name = document.createElement('b');
  name.textContent = b.name || b.handle || 'Untitled';
  const handle = document.createElement('span');
  handle.textContent = b.name && b.handle ? b.handle : '';
  who.append(name, handle);

  const acts = document.createElement('div');
  acts.className = 'acts';
  acts.append(
    linkButton('Apply', () => applyBrandRow(b)),
    b.is_default
      ? Object.assign(document.createElement('span'), { className: 'defaultflag', textContent: 'Default' })
      : linkButton('Make default', () => setDefaultBrand(b)),
    linkButton('Delete', () => deleteBrand(b))
  );

  row.append(who, acts);
  return row;
}

async function loadBrands({ force = false } = {}) {
  if (!state.user) return [];
  if (state.brands && !force) return state.brands;
  const r = await api('/api/brands');
  state.brands = r.ok ? r.brands : [];
  return state.brands;
}

/**
 * A stored brand row → the deck's `brand` field: drop the storage columns and
 * every empty value, because `logo_url: null` on a deck fails the schema.
 * Mirrors `toDeckBrand()` in src/brands.js.
 */
function brandRowToDeckBrand(row) {
  const brand = {};
  if (row?.name) brand.name = row.name;
  if (row?.handle) brand.handle = row.handle;
  if (row?.logo_url) brand.logo_url = row.logo_url;
  return Object.keys(brand).length ? brand : null;
}

/** Copy a saved brand onto the deck. The deck's own field is what renders. */
function applyBrandRow(b) {
  const next = brandRowToDeckBrand(b);
  if (next) state.deck.brand = next;
  else delete state.deck.brand;
  buildBrandTab();
  refreshPreview();
  refreshThumb(state.index);
  revalidate();
}

/** The footer fields as a brand row, or null when there is nothing to save. */
function brandFromInputs() {
  const brand = state.deck.brand ?? {};
  const name = (brand.name ?? '').trim();
  const handle = (brand.handle ?? '').trim();
  if (!name && !handle) return null;
  return { name, handle, logo_url: brand.logo_url ?? null };
}

async function saveCurrentBrand(asDefault) {
  const body = brandFromInputs();
  if (!body) return ($('#stageNote').textContent = 'Fill in a name or handle first.');
  const r = await api('/api/brands', { ...body, is_default: asDefault });
  if (!r.ok) return ($('#stageNote').textContent = `Could not save the brand — ${r.message}`);
  state.brands = null;                                   // the list changed; refetch
  if (asDefault) state.defaultBrand = brandRowToDeckBrand(body);
  buildBrandTab();
}

// PUT normalises the whole row server-side, so send every column — omitting
// logo_url here would quietly clear it while only meaning to move the star.
async function setDefaultBrand(b) {
  const body = { name: b.name, handle: b.handle, logo_url: b.logo_url ?? null, is_default: true };
  const r = await api(`/api/brands/${b.id}`, body, { method: 'PUT' });
  if (!r.ok) return ($('#stageNote').textContent = `Could not set the default — ${r.message}`);
  state.brands = null;
  state.defaultBrand = brandRowToDeckBrand(b);
  buildBrandTab();
}

async function deleteBrand(b) {
  if (!confirm(`Delete the brand "${b.name || b.handle}"?`)) return;
  const r = await api(`/api/brands/${b.id}`, null, { method: 'DELETE' });
  if (!r.ok) return ($('#stageNote').textContent = `Could not delete the brand — ${r.message}`);
  state.brands = null;
  if (b.is_default) state.defaultBrand = null;
  buildBrandTab();
}

// --------------------------------------------------------------------- AI tab
/**
 * One slide, rewritten. Deliberately not "regenerate the deck": the deck's shape
 * was the expensive decision and it is usually fine — it is a single slide that
 * lands flat. A preset click runs immediately (the steer box is optional extra
 * direction), because making the user pick a preset *and* press a button is one
 * click of ceremony for no information.
 */
function buildAiTab() {
  const host = $('#tabAi');
  host.innerHTML = '';
  const presets = state.meta.rewritePresets ?? [];

  const head = document.createElement('div');
  head.className = 'subhead';
  head.textContent = 'Rewrite this slide';
  host.appendChild(head);

  if (!state.meta.hasApiKey) {
    const off = document.createElement('p');
    off.className = 'why';
    off.textContent = 'No model key on the server, so rewriting is off. Everything else in the editor works.';
    host.appendChild(off);
    return;
  }

  const row = document.createElement('div');
  row.className = 'aipresets';
  for (const p of presets) {
    const b = document.createElement('button');
    b.className = 'btn-ghost sm';
    b.dataset.preset = p.id;
    b.textContent = p.label;
    b.onclick = () => runRewrite(p.id);
    row.appendChild(b);
  }
  host.appendChild(row);

  const wrap = document.createElement('div');
  wrap.className = 'f';
  const lab = document.createElement('label');
  lab.setAttribute('for', 'aiSteer');
  lab.textContent = 'Or say what to change';
  wrap.appendChild(lab);
  const box = document.createElement('textarea');
  box.id = 'aiSteer';
  box.rows = 2;
  box.maxLength = 400;
  box.placeholder = 'e.g. drop the metaphor, name the tool';
  wrap.appendChild(box);
  host.appendChild(wrap);

  const go = document.createElement('button');
  go.className = 'btn-go';
  go.id = 'aiRunBtn';
  go.innerHTML = '<span class="label">Rewrite</span> <span class="cost">1 credit</span>';
  go.onclick = () => runRewrite(null);
  host.appendChild(go);

  const note = document.createElement('p');
  note.className = 'ainote';
  note.id = 'aiNote';
  host.appendChild(note);

  const why = document.createElement('p');
  why.className = 'why';
  why.textContent = 'Your words are kept for anything the model leaves out, and Ctrl+Z puts the old slide back. A rewrite that changes nothing is refunded.';
  host.appendChild(why);
}

function aiBusy(on, label) {
  for (const b of $$('#tabAi button')) b.disabled = on;
  const note = $('#aiNote');
  if (note && label) { note.textContent = label; note.className = 'ainote'; }
}

async function runRewrite(presetId) {
  const slide = state.deck.slides[state.index];
  const instruction = ($('#aiSteer')?.value ?? '').trim();
  if (!presetId && !instruction) {
    const note = $('#aiNote');
    note.className = 'ainote bad';
    note.textContent = 'Pick one of the presets, or type what to change.';
    return;
  }
  aiBusy(true, 'Rewriting…');
  const r = await api('/api/rewrite', {
    slide,
    preset: presetId,
    instruction,
    index: state.index,
    total: state.deck.slides.length,
    title: state.deck.title,
    narrative_type: state.deck.narrative_type,
    platform: state.deck.platform,
  });
  aiBusy(false);
  const note = $('#aiNote');

  if (typeof r.credits === 'number') { state.credits = r.credits; renderCredits(); }
  if (!r.ok) {
    note.className = 'ainote bad';
    note.textContent = [r.message, ...(r.notes ?? [])].join(' · ');
    return;
  }

  state.deck.slides[state.index] = r.slide;
  buildContentTab();
  refreshPreview();
  refreshThumb(state.index);
  revalidate({ discrete: true });     // one undo step puts the old slide back

  note.className = `ainote ${r.changed ? 'good' : ''}`;
  note.textContent = r.changed
    ? ['Rewritten — Ctrl+Z to go back.', ...(r.notes ?? [])].join(' · ')
    : (r.notes ?? ['The model returned it unchanged.']).join(' · ');
}

// ------------------------------------------------------------- validation
/**
 * The authoritative check is the server's: same Ajv instance, same lint, same
 * schema. Re-implementing either in the browser would be two things to keep in
 * agreement, and they would stop agreeing.
 */
const runValidate = debounce(async () => {
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

/**
 * Every deck mutation in the editor already called revalidate(), which makes this
 * the one honest choke point for "the deck changed" — so undo and autosave hook
 * here rather than being threaded through thirteen call sites that would each be
 * one more place to forget. Passive callers (opening a deck, restoring a
 * snapshot) pass `{ passive: true }` and get validation without the bookkeeping.
 *
 * `discrete: true` is for a change that replaces a block of text wholesale — an
 * AI rewrite, a bullet dropped. Those must not be coalesced into the keystroke
 * the user happened to type a moment earlier, or one Ctrl+Z would undo both.
 */
function revalidate({ passive = false, discrete = false } = {}) {
  if (!passive) {
    if (discrete) history.at = 0;   // force pushHistory past its coalesce window
    pushHistory();
    markDirty();
  }
  runValidate();
}

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

// ------------------------------------------------------------------- download
/**
 * Fetch the file, then click a synthetic <a download>.
 *
 * A plain `<a href="/api/export">` would be simpler and cannot work: a link
 * cannot carry an Authorization header, so the request would arrive anonymous and
 * come back 401. So the bytes come through fetch() — which also means the
 * watermark note below is readable, since we get the headers.
 */
async function exportDeck(format) {
  $('#exportPop').hidden = true;
  $('#exportBtn').setAttribute('aria-expanded', 'false');
  const btn = $('#exportBtn');
  const label = $('.label', btn);
  const was = label.textContent;
  btn.disabled = true;
  label.textContent = format === 'png' ? 'Rendering…' : 'Rendering all…';
  $('#stageNote').textContent = '';

  try {
    const res = await api(
      '/api/export',
      { deck: state.deck, format, ...(format === 'png' ? { index: state.index } : {}) },
      { raw: true }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      $('#stageNote').textContent = `Download failed — ${err.message}`;
      return;
    }

    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `carousel.${format}`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a timer, not immediately: Chrome needs the URL to still resolve
    // when it starts the download, which happens after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    $('#stageNote').textContent =
      res.headers.get('x-storyloom-watermark') === 'forced'
        ? `${name} — exported with the watermark, which is a Pro feature to remove.`
        : `${name} downloaded.`;
  } finally {
    btn.disabled = false;
    label.textContent = was;
  }
}

boot();
window.__devSeed = (deck) => openEditor(deck, { source: 'template' });
