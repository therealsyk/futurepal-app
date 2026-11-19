// Login com Google, Facebook e Apple (Supabase Auth, fluxo PKCE).
//   Browser  : redireciona para o fornecedor e volta à app (o supabase-js troca o ?code= pela sessão).
//   Windows  : abre o browser do sistema; o fornecedor volta para http://127.0.0.1:53682/auth-callback (servidor local da app)
//              ou, se essa porta estiver ocupada, para futurepal://auth-callback (registado pelo instalador).
//   Telemóvel: abre um browser seguro (@capacitor/browser); volta para com.futurepal.app://auth-callback.
// Cada fornecedor tem de estar ativo no painel do Supabase (ver LOGIN_SOCIAL.md).
import { Capacitor } from '@capacitor/core';
import { getSupabase } from './supabase';

export type OAuthProvider = 'google' | 'facebook' | 'apple';
export const DESKTOP_REDIRECT = 'futurepal://auth-callback';
export const MOBILE_REDIRECT = 'com.futurepal.app://auth-callback';

interface AuthBridge {
  openExternal?: (url: string) => Promise<void>;
  oauthRedirect?: () => Promise<string | null>;
  onAuthCallback?: (cb: (url: string) => void) => () => void;
}
const bridge = (): AuthBridge | undefined => (globalThis as unknown as { __electronBridge?: AuthBridge }).__electronBridge;

export function oauthRedirectUrl(): string {
  if (bridge()) return DESKTOP_REDIRECT;
  if (Capacitor.isNativePlatform()) return MOBILE_REDIRECT;
  return window.location.origin + window.location.pathname; // sem o #/rota
}

export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('not-configured');
  // Windows: de preferência o endereço local (http://127.0.0.1:…); o futurepal:// fica de reserva.
  const local = await bridge()?.oauthRedirect?.().catch(() => null);
  const redirectTo = local || oauthRedirectUrl();
  const native = Boolean(bridge()) || Capacitor.isNativePlatform();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: native, scopes: provider === 'facebook' ? 'email' : undefined },
  });
  if (error) throw error;
  if (!native) return; // no browser o supabase-js já está a mudar de página
  if (!data?.url) throw new Error('no-url');
  const b = bridge();
  if (b?.openExternal) { await b.openExternal(data.url); return; }
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url, presentationStyle: 'popover' });
}

/** Recebe o link de volta (futurepal://… ou com.futurepal.app://…) e cria a sessão. */
export async function completeOAuth(url: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'not-configured' };
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, error: 'bad-url' }; }
  const params = new URLSearchParams(u.search || u.hash.replace(/^#/, ''));
  const err = params.get('error_description') || params.get('error');
  if (Capacitor.isNativePlatform()) {
    try { const { Browser } = await import('@capacitor/browser'); await Browser.close(); } catch { /* já fechado */ }
  }
  if (err) return { ok: false, error: err };
  const code = params.get('code');
  if (!code) return { ok: false, error: 'no-code' };
  const { error } = await sb.auth.exchangeCodeForSession(code);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Liga a receção dos links de volta (uma vez, no AuthProvider). Devolve a função para desligar. */
export function listenForOAuthCallbacks(onError?: (msg: string) => void): () => void {
  const handle = (url: string) => {
    if (!url.includes('auth-callback')) return;
    completeOAuth(url).then((r) => { if (!r.ok && r.error && onError) onError(r.error); }).catch(() => {});
  };
  const b = bridge();
  if (b?.onAuthCallback) return b.onAuthCallback(handle);
  if (Capacitor.isNativePlatform()) {
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(({ App }) =>
      App.addListener('appUrlOpen', ({ url }) => handle(url)).then((h) => { remove = () => { h.remove(); }; }),
    ).catch(() => {});
    return () => remove?.();
  }
  return () => {};
}
