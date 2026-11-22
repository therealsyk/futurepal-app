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

/** Quantas pessoas dividem (membros + convites por responder). null = não deu para saber. */
export async function splitPeople(splitId: string): Promise<{ members: string[]; pending: number } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const [m, i] = await Promise.all([sb.from('split_members').select('user_id').eq('group_id', splitId), sb.from('split_invites').select('id').eq('group_id', splitId).eq('status', 'pending')]);
  if (m.error || !m.data?.length) return null;
  return { members: (m.data as Array<{ user_id: string }>).map((x) => x.user_id), pending: i.data?.length ?? 0 };
}

/** Transação num grupo dividido: fica dividida por todos. Devolve a minha parte, ou o erro. */
export async function addSplitTransaction(splitId: string, description: string, cents: number, date: string): Promise<{ share: number } | { error: string }> {
  const sb = getSupabase(), p = await splitPeople(splitId);
  if (!sb || !p) return { error: 'offline' };
  const { error } = await sb.rpc('add_split_bill', { p_group: splitId, p_description: description, p_amount_cents: cents, p_date: date, p_members: p.members, p_creator_paid: true });
  return error ? { error: error.message } : { share: Math.ceil(cents / (p.members.length + p.pending)) };
}
