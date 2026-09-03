import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Import the app, THEN assert the degradation contract by clearing Supabase env.
// Importing server.js pulls in generate.js, whose module-scope loadEnvFile() (the
// Sept 2 "read config before the constants" fix) loads .env — which now also
// carries the Supabase keys. So the vars must be cleared *after* the import, not
// before: every consumer reads env lazily at request time and nothing reloads
// .env again, so degraded mode holds for the rest of the process.
const { app } = await import('../src/server.js');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let base;
let server;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (p, opts) => {
  const res = await fetch(base + p, opts);
  return { status: res.status, body: await res.json() };
};

test('/api/meta is public and reports supabase:null when unconfigured', async () => {
  const { status, body } = await call('/api/meta');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.supabase, null);
  assert.equal(typeof body.hasApiKey, 'boolean');
});

test('/api/health is public', async () => {
  const { status, body } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('authoring routes stay OPEN in degraded mode (Week A still works)', async () => {
  // Template gallery: no auth, no credit — must keep working without Supabase.
  const defaults = await call('/api/defaults');
  assert.equal(defaults.status, 200);
  assert.equal(defaults.body.ok, true);
  assert.ok(Array.isArray(defaults.body.decks));

  // Generate is reachable (not auth-gated); with no input it short-circuits at
  // no_input BEFORE any model or credit logic, so this is hermetic re: API keys.
  const gen = await call('/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.notEqual(gen.body.kind, 'unauthorized');
  assert.equal(gen.body.kind, 'no_input');
});

test('account routes are hard-gated → 401 without a user', async () => {
  for (const p of ['/api/decks', '/api/decks/abc']) {
    const { status, body } = await call(p);
    assert.equal(status, 401, `${p} should be 401`);
    assert.equal(body.kind, 'unauthorized');
  }
});
