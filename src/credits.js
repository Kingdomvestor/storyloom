/**
 * credits.js — the credit ledger. The only correctness rule that matters:
 * spend() is atomic (a single UPDATE … WHERE credits > 0 RETURNING), so two
 * concurrent generations can never take the balance below zero. A null return
 * means the decrement matched no row — the user is out.
 */
import { admin } from './supabase.js';

export async function spend(userId) {
  const { data, error } = await admin().rpc('spend_credit', { uid: userId });
  if (error) throw new Error(`spend_credit: ${error.message}`);
  return typeof data === 'number' ? data : null; // null → out of credits
}

export async function refund(userId) {
  const { data, error } = await admin().rpc('add_credit', { uid: userId });
  if (error) throw new Error(`add_credit: ${error.message}`);
  return typeof data === 'number' ? data : null;
}

export async function balance(userId) {
  const { data, error } = await admin()
    .from('profiles').select('credits').eq('id', userId).single();
  if (error) throw new Error(`balance: ${error.message}`);
  return data.credits;
}
