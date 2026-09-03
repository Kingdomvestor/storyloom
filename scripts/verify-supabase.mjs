/**
 * verify-supabase.mjs — proves the live Supabase wiring end to end.
 *
 * The degradation tests (npm test) cover the no-keys path; this covers the
 * with-keys path they can't touch. It creates a throwaway auth user — which
 * must fire handle_new_user and grant 10 credits — exercises spend/refund and
 * user-scoped deck CRUD, then deletes the user so the project is left exactly
 * as it was.
 *
 *   node scripts/verify-supabase.mjs      (or: npm run verify:supabase)
 *
 * Prints PASS/FAIL lines and the throwaway user id only — never any key.
 */
import { randomUUID } from 'node:crypto';

process.loadEnvFile(); // keys come from .env, never argv/stdout

const { hasSupabase, admin } = await import('../src/supabase.js');
const credits = await import('../src/credits.js');
const decks = await import('../src/decks.js');

if (!hasSupabase()) {
  console.error('✖ Supabase env not set. Add SUPABASE_URL, SUPABASE_ANON_KEY and\n' +
    '  SUPABASE_SERVICE_ROLE_KEY to .env, then re-run.');
  process.exit(1);
}

const sb = admin();
let failed = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? '✔' : '✖'} ${label}`);
  if (!ok) failed++;
};

// A real auth user (the trigger only fires on auth.users), created via the
// service role. email_confirm skips the mail round-trip.
const { data: created, error: cErr } = await sb.auth.admin.createUser({
  email: `verify-${randomUUID()}@example.com`,
  password: randomUUID(),
  email_confirm: true,
});
if (cErr) { console.error('✖ createUser:', cErr.message); process.exit(1); }
const uid = created.user.id;
console.log(`\n  throwaway user ${uid}\n`);

try {
  check('signup granted 10 credits', (await credits.balance(uid)) === 10);
  check('spend_credit → 9', (await credits.spend(uid)) === 9);
  check('add_credit → 10', (await credits.refund(uid)) === 10);

  const probe = { probe: true, note: 'verify-supabase' };
  const id = await decks.create(uid, { title: 'verify', source: 'ai', deck: probe });
  check('deck create returns an id', typeof id === 'string' && id.length > 0);
  check('deck list shows the row', (await decks.list(uid)).some((d) => d.id === id));

  const got = await decks.get(uid, id);
  check('deck get returns the stored deck', got?.id === id && got.deck?.probe === true);
  check('deck get is user-scoped (stranger → null)', (await decks.get(randomUUID(), id)) === null);

  const upd = await decks.update(uid, id, { title: 'verify v2', source: 'ai', deck: probe });
  check('deck update returns the row', upd?.id === id);
  check('deck update is user-scoped (stranger → null)',
    (await decks.update(randomUUID(), id, { title: 'x', source: 'ai', deck: probe })) === null);

  check('deck remove → true', (await decks.remove(uid, id)) === true);
  check('deck remove again → false', (await decks.remove(uid, id)) === false);

  // Drain the balance and confirm the floor holds.
  for (let i = 0; i < 10; i++) await credits.spend(uid);
  check('spend past zero → null (out of credits)', (await credits.spend(uid)) === null);
  check('balance floored at 0', (await credits.balance(uid)) === 0);
} finally {
  const { error: dErr } = await sb.auth.admin.deleteUser(uid);
  console.log(dErr ? `\n  cleanup warning: ${dErr.message}` : '\n  throwaway user deleted');
}

console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nAll checks passed ✔\n');
process.exit(failed ? 1 : 0);
