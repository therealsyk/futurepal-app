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
let adminClient: SupabaseClient | null = null;
/** Domínio interno das contas do painel (a pessoa só escreve o nome de utilizador). */
export const STAFF_DOMAIN = 'staff.futurepal.invalid'; // .invalid: reservado, nunca pode ser registado (ninguém recebe emails de recuperação)

/** Sessão própria do painel de administração (nome de utilizador + senha + 2FA), separada da conta da app.
 *  Guarda-se só nesta janela (sessionStorage): fechar a janela termina a sessão do painel. */
export function getAdminSupabase(): SupabaseClient | null {
  if (!hasSupabaseConfig()) return null;
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'futurepal-admin', storage: typeof window !== 'undefined' ? window.sessionStorage : undefined },
    });
  }
  return adminClient;
}

export function getSupabase(): SupabaseClient | null {
  if (!hasSupabaseConfig()) return null;
  if (!client) {
    // PKCE: o login social devolve um ?code= que é trocado pela sessão. No browser o supabase-js faz isso sozinho;
    // no Windows/telemóvel faz-se em auth/oauth.ts quando chega o link de volta.
    const inBrowser = typeof window !== 'undefined' && !(window as unknown as { __electronBridge?: unknown }).__electronBridge
      && !(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce', detectSessionInUrl: inBrowser },
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
export async function signUp(email: string, password: string, name?: string, phone?: string): Promise<{ user: User | null; needsConfirmation: boolean }> {
  const data: Record<string, string> = {};
  if (name) data.name = name;
  if (phone) data.phone = phone; // guardado no perfil (sem SMS); serve, p.ex., para receber convites de divisão de contas
  const res = await need().auth.signUp({ email, password, options: { data: Object.keys(data).length ? data : undefined } });
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

/** Apaga a conta da pessoa e todos os dados dela na nuvem (função delete_my_account no schema.sql). */
export async function deleteMyAccount(): Promise<void> {
  const sb = need();
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw error;
  await sb.auth.signOut();
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // Terminar sessão = esta conta sai também da lista "Trocar de conta" deste aparelho
  const { data } = await sb.auth.getSession();
  if (data.session?.user) {
    try {
      const k = 'wallet.savedAccounts';
      const list = JSON.parse(localStorage.getItem(k) || '[]') as Array<{ id: string }>;
      localStorage.setItem(k, JSON.stringify(list.filter((a) => a.id !== data.session!.user.id)));
    } catch { /* sem storage */ }
  }
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
  if (msg === 'provider-disabled' || msg.includes('provider is not enabled') || msg.includes('unsupported provider')) return 'auth.err_providerOff';
  if (code === 'invalid_credentials' || msg.includes('invalid login')) return 'auth.err_invalid';
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'auth.err_notConfirmed';
  if (code === 'user_already_exists' || msg.includes('already registered')) return 'auth.err_exists';
  if (code === 'weak_password' || msg.includes('password should')) return 'auth.err_weak';
  if (code === 'over_email_send_rate_limit' || msg.includes('rate limit')) return 'auth.err_rate';
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'auth.err_network';
  return 'auth.err_generic';
}

/** Que fornecedores de login (google, facebook, apple…) estão ativos no Supabase. */
export async function enabledProviders(): Promise<Record<string, boolean>> {
  if (!hasSupabaseConfig()) return {};
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    const j = await r.json();
    return (j?.external ?? {}) as Record<string, boolean>;
  } catch { return {}; }
}

/** Telemóvel em formato internacional só com dígitos (assume +351 para 9 dígitos portugueses). null se inválido. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 9 && /^[29]/.test(d)) return '351' + d;
  if (d.length >= 10 && d.length <= 15) return d.replace(/^00/, '');
  return null;
}
