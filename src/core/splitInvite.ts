// Responder a um convite de divisão (aviso ao abrir a app, notificações). Devolve a mensagem de erro, ou null.
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '../auth/supabase';
import { SPLIT_CHANGED } from './groupLink';

export async function answerSplitInvite(user: User | null, id: string, accept: boolean): Promise<string | null> {
  const sb = getSupabase();
  if (!sb || !user) return 'no session';
  const m = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const { error } = await sb.rpc('answer_split_invite', { p_invite: id, p_accept: accept, p_display_name: m.full_name || m.name || (user.email ?? '').split('@')[0] });
  if (error) return error.message;
  window.dispatchEvent(new Event(SPLIT_CHANGED));
  return null;
}
