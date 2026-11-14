import { createClient } from '@supabase/supabase-js';

// Config via environment variables (never hard-coded secrets).
// For local dev without a real Supabase project, set VITE_SUPABASE_URL/KEY or
// leave empty -> the app stays fully offline (local-first per SPEC 2).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

let client: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!hasSupabaseConfig()) return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}

export async function signUp(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not configured');
  const res = await sb.auth.signUp({ email, password });
  if (res.error) throw res.error;
  return res.data.user;
}

export async function signIn(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not configured');
  const res = await sb.auth.signInWithPassword({ email, password });
  if (res.error) throw res.error;
  return res.data.user;
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

// Pure helpers so the auth logic can be unit-tested without a network.
// These do not touch Supabase; they only decide whether sync is possible.
export function canSync(user: { id?: string } | null): boolean {
  return Boolean(user && user.id);
}
