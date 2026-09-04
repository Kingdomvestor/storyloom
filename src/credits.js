/**
 * credits.js - the credit ledger. The only correctness rule that matters:
 * spend() is atomic (a single UPDATE ... WHERE credits > 0 RETURNING), so two
 * concurrent generations can never take the balance below zero. A null return
 * means the user is out.
 */
import { admin } from './supabase.js';

/**
 * Repair old/misaligned projects where auth.users exists but the profiles row
 * was not created. The FK still proves the user is real.
 */
export async function ensure(userId) {
  const client = admin();
  const { error } = await client.from('profiles').insert({ id: userId });
  if (error && error.code !== '23505') throw new Error(`profiles.ensure: ${error.message}`);
}

export async function spend(userId) {
  await ensure(userId);
  const { data, error } = await admin().rpc('spend_credit', { uid: userId });
  if (error) throw new Error(`spend_credit: ${error.message}`);
  return typeof data === 'number' ? data : null; // null -> out of credits
}

export async function refund(userId) {
  const { data, error } = await admin().rpc('add_credit', { uid: userId });
  if (error) throw new Error(`add_credit: ${error.message}`);
  return typeof data === 'number' ? data : null;
}

/**
 * The row behind both the credit counter and the tier check: `{ credits, plan }`.
 * One read, because every caller that wants the balance also wants to know
 * whether this user is allowed to turn the watermark off.
 */
export async function profile(userId) {
  await ensure(userId);
  const client = admin();
  // `plan` arrives with migration 0002. The fallback keeps a database that has
  // only 0001 applied fully working — it simply reads as the free tier, which is
  // the column's default anyway.
  let { data, error } = await client
    .from('profiles').select('credits, plan').eq('id', userId).single();
  if (error) {
    ({ data, error } = await client
      .from('profiles').select('credits').eq('id', userId).single());
    if (error) throw new Error(`profile: ${error.message}`);
  }
  return { credits: data.credits, plan: data.plan ?? 'free' };
}

export async function balance(userId) {
  return (await profile(userId)).credits;
}
