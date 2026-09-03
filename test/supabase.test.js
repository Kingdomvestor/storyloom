import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ensure a clean, unconfigured environment BEFORE importing the module.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { hasSupabase, admin, publicConfig, getUser } = await import('../src/supabase.js');

test('degrades cleanly when unconfigured', async () => {
  assert.equal(hasSupabase(), false);
  assert.equal(admin(), null);
  assert.equal(publicConfig(), null);
  assert.equal(await getUser('any-token'), null);
  assert.equal(await getUser(''), null);
});
