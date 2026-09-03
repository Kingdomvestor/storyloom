/**
 * supabase.js — the server's line to Supabase.
 *
 * Three things are load-bearing here:
 *  1. The service-role client bypasses RLS, so it is server-only and never
 *     leaves this process. Only publicConfig() is safe to hand the browser.
 *  2. Absent env must not crash the app. hasSupabase() gates everything,
 *     mirroring generate.js's hasApiKey — the app boots and /api/meta simply
 *     reports supabase:null.
 *  3. Env is read *lazily*, never at import time. server.js loads .env in its
 *     start guard, which runs after this module is imported; reading eagerly
 *     would capture an empty env and leave the app permanently "unconfigured"
 *     even with keys present. generate.js reads GEMINI_API_KEY the same way.
 */
import { createClient } from '@supabase/supabase-js';

const env = () => ({
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

/** True only when all three vars are present. */
export function hasSupabase() {
  const { url, anon, service } = env();
  return Boolean(url && anon && service);
}

// Service-role: full access, RLS bypassed. Built once, then reused. No session
// persistence — a stateless server client that only acts on a verified user id.
let _admin = null;
export function admin() {
  if (_admin) return _admin;
  if (!hasSupabase()) return null;
  const { url, service } = env();
  _admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  return _admin;
}

/** Browser-safe config, or null when unconfigured. */
export function publicConfig() {
  if (!hasSupabase()) return null;
  const { url, anon } = env();
  return { url, anonKey: anon };
}

/** Verify a user's access token. Returns { id, email } or null. */
export async function getUser(token) {
  const client = admin();
  if (!client || !token) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}
