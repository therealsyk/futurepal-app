import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

// Config via environment variables (never hard-coded secrets).
// Aceita a chave nova do Supabase ("publishable", sb_publishable_...) ou a antiga "anon".
// Sem URL/chave a app fica 100% local (SPEC 2: local-first).
// NUNCA pôr aqui a chave "service_role"/"secret": essa só pode existir num servidor.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_KEY || '';

export function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!hasSupabaseConfig()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

function need(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) throw new Error('not-configured');
  return sb;
}

// Devolve { user, needsConfirmation }: com "Confirm email" ligado no Supabase o registo
// não cria sessão até a pessoa clicar no link do email.
export async function signUp(email: string, password: string, name?: string): Promise<{ user: User | null; needsConfirmation: boolean }> {
  const res = await need().auth.signUp({ email, password, options: { data: name ? { name } : undefined } });
  if (res.error) throw res.error;
  return { user: res.data.user, needsConfirmation: !res.data.session };
}

export async function signIn(email: string, password: string): Promise<User | null> {
  const res = await need().auth.signInWithPassword({ email, password });
  if (res.error) throw res.error;
  return res.data.user;
}

export async function resetPassword(email: string): Promise<void> {
  const res = await need().auth.resetPasswordForEmail(email);
  if (res.error) throw res.error;
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

// Pure helpers so the auth logic can be unit-tested without a network.
export function canSync(user: { id?: string } | null): boolean {
  return Boolean(user && user.id);
}

// Mensagens de erro do Supabase -> chave i18n (auth.err_*).
export function authErrorKey(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase();
  const code = String((err as { code?: string })?.code ?? '').toLowerCase();
  if (msg === 'not-configured') return 'auth.err_notConfigured';
  if (code === 'invalid_credentials' || msg.includes('invalid login')) return 'auth.err_invalid';
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'auth.err_notConfirmed';
  if (code === 'user_already_exists' || msg.includes('already registered')) return 'auth.err_exists';
  if (code === 'weak_password' || msg.includes('password should')) return 'auth.err_weak';
  if (code === 'over_email_send_rate_limit' || msg.includes('rate limit')) return 'auth.err_rate';
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'auth.err_network';
  return 'auth.err_generic';
}
