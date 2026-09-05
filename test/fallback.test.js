/**
 * fallback.test.js — the model chain, with fetch stubbed.
 *
 * The bug this covers was visible to a user: "http_error: This model is currently
 * experiencing high demand." A 503 from Gemini is per-model, so the fix is to ask a
 * different one — and the thing worth testing is the *restraint*, not the retry. A
 * chain that walks on every failure turns one clear error into three slow ones, so
 * these tests assert exactly which models were asked.
 *
 * No network: globalThis.fetch is replaced and the key is overwritten with a
 * throwaway string, so nothing here can reach Google or spend quota.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Both are read at module scope, so they have to be set before the import.
process.env.GEMINI_RETRY_BASE_MS = '1';          // otherwise 1s + 3s per busy model
process.env.GEMINI_FALLBACK_MODELS = 'model-b,model-c';

const { generateDeck, MODEL, modelChain } = await import('../src/generate.js');

process.env.GEMINI_API_KEY = 'test-key-never-sent';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

const HIGH_DEMAND = { error: { code: 503, status: 'UNAVAILABLE',
  message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.' } };

// What a model is supposed to hand back: the authored half of a known-good deck.
// assemble() adds the fields the application owns, so this is the smallest input
// that gets all the way through Ajv.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/sample-5.json', import.meta.url), 'utf8'));
const WROTE_A_DECK = {
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ title: fixture.title, slides: fixture.slides }) }] } }],
  usageMetadata: { totalTokenCount: 1 },
};

const SOURCE = 'A portfolio site is the only asset a developer owns outright. '.repeat(6);

/** Stub fetch, recording every model asked in order. */
function record(handler) {
  const asked = [];
  globalThis.fetch = async (url) => {
    const model = /models\/([^:]+):/.exec(String(url))[1];
    asked.push(model);
    return handler(model, asked);
  };
  return asked;
}

test('the chain leads with the primary and never asks one twice', () => {
  assert.deepEqual(modelChain(MODEL), [MODEL, 'model-b', 'model-c']);
  // A primary that is also a fallback must not be tried twice — the whole point of
  // moving on is to move on.
  assert.deepEqual(modelChain('model-b'), ['model-b', 'model-c']);
});

test('a busy model hands the prompt to the next one, and the notes say so', async () => {
  const asked = record((model) => (model === MODEL ? reply(503, HIGH_DEMAND) : reply(200, WROTE_A_DECK)));

  const r = await generateDeck({ text: SOURCE });
  assert.equal(r.ok, true, `generate failed: ${r.kind} — ${r.message}`);
  // Three attempts on the primary (a 503 might be a blip), then model-b answers.
  assert.deepEqual(asked, [MODEL, MODEL, MODEL, 'model-b']);
  assert.ok(r.notes.some((n) => n.includes('was busy') && n.includes('model-b')),
    `no note naming the substitute: ${r.notes.join(' | ')}`);
  assert.equal(r.deck.slides.length, fixture.slides.length);
});

test('when every model is busy, the error names them and drops Google\'s wording', async () => {
  const asked = record(() => reply(503, HIGH_DEMAND));

  const r = await generateDeck({ text: SOURCE });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'overloaded', 'must not be reported as a generic http_error');
  assert.match(r.message, /Every model tried is busy \(.*model-c\)/);
  assert.equal(asked.length, 9, '3 models x 3 attempts');
  // The upstream sentence is kept where a developer can find it, not shown.
  assert.ok(r.notes.some((n) => n.includes('high demand')), r.notes.join(' | '));
  assert.ok(r.notes.some((n) => n.includes('tried')), r.notes.join(' | '));
});

test('a failure another model cannot fix stops at the first model', async () => {
  // The restraint half. Walking the chain here would triple the wait to reach the
  // same answer, and on a paid key it would triple the bill.
  for (const [label, body, status, kind] of [
    ['a blocked prompt', { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }, 200, 'blocked'],
    ['a rejected request', { error: { message: 'API key not valid' } }, 400, 'http_error'],
  ]) {
    const asked = record(() => reply(status, body));
    const r = await generateDeck({ text: SOURCE });
    assert.equal(r.ok, false, label);
    assert.equal(r.kind, kind, label);
    assert.deepEqual(asked, [MODEL], `${label}: toured the chain instead of stopping`);
  }
});
