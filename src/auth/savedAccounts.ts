// Contas com sessão iniciada neste aparelho (para "Trocar de conta", estilo "Quem está a usar?").
// O Supabase só mantém UMA sessão ativa; aqui guardamos a sessão de cada conta que já entrou (tal como o próprio
// supabase-js guarda a sessão atual no localStorage), para trocar sem pedir a palavra-passe outra vez.
import type { Session, SupabaseClient } from '@supabase/supabase-js';

export interface SavedAccount {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  access: string;
  refresh: string;
  lastUsed: string;
}

const KEY = 'wallet.savedAccounts';
export const SAVED_EVENT = 'wallet:saved-accounts';

export function savedAccounts(): SavedAccount[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as SavedAccount[]; } catch { return []; }
}
function store(list: SavedAccount[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* sem storage */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SAVED_EVENT));
}

/** Guarda (ou atualiza) a sessão da conta atual. Chamado sempre que a sessão muda (entrar, renovar o token). */
export function rememberSession(s: Session | null): void {
  if (!s?.user || !s.refresh_token) return;
  const meta = (s.user.user_metadata ?? {}) as { name?: string; full_name?: string; avatar_custom?: string | null; avatar_url?: string; picture?: string };
  const email = s.user.email ?? '';
  const entry: SavedAccount = {
    id: s.user.id,
    email,
    name: meta.full_name || meta.name || email.split('@')[0] || '?',
    avatar: meta.avatar_custom || meta.avatar_url || meta.picture || null,
    access: s.access_token,
    refresh: s.refresh_token,
    lastUsed: new Date().toISOString(),
  };
  store([entry, ...savedAccounts().filter((a) => a.id !== entry.id)]);
}

export function forgetAccount(id: string): void {
  store(savedAccounts().filter((a) => a.id !== id));
}

/** Passa para outra conta guardada. Se a sessão já não for válida, tira-a da lista e devolve false. */
export async function switchToAccount(sb: SupabaseClient, id: string): Promise<boolean> {
  const a = savedAccounts().find((x) => x.id === id);
  if (!a) return false;
  const { data, error } = await sb.auth.setSession({ access_token: a.access, refresh_token: a.refresh });
  if (error || !data.session) { forgetAccount(id); return false; }
  rememberSession(data.session);
  return true;
}

/** ATENÇÃO: o signOut, mesmo com scope 'local', anula a sessão no servidor (deixa de se poder voltar a esta conta).
 *  Para "Adicionar conta" não usar: basta entrar com a outra conta (ver AccountSwitcher). */
export async function leaveForAnotherAccount(sb: SupabaseClient): Promise<void> {
  const { data } = await sb.auth.getSession();
  rememberSession(data.session);
  await sb.auth.signOut({ scope: 'local' });
}
