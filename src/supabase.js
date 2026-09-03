/**
 * supabase.js — the server's line to Supabase.
 *
 * Two things are load-bearing here:
 *  1. The service-role client bypasses RLS, so it is server-only and never
 *     leaves this process. Only publicConfig() is safe to hand the browser.
 *  2. Absent env must not crash the app. hasSupabase gates everything,
 *     mirroring generate.js's hasApiKey — the app boots and /api/meta simply
 *     reports supabase:null.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasSupabase = Boolean(URL && ANON && SERVICE);

// Service-role: full access, RLS bypassed. No session persistence — this is a
// stateless server client that only ever acts on behalf of a verified user id.
export const admin = hasSupabase
  ? createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

/** Browser-safe config, or null when unconfigured. */
export function publicConfig() {
  return hasSupabase ? { url: URL, anonKey: ANON } : null;
}

/** Verify a user's access token. Returns { id, email } or null. */
export async function getUser(token) {
  if (!admin || !token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}
