// Planeamento: lê os dados que já existem (nada é copiado nem guardado à parte) e as opções da previsão.
import type { WalletDB } from '../db/database';
import { getSupabase } from '../auth/supabase';
import { loadSettings } from './settings';
import { DEFAULT_PLAN_OPTIONS, type PlanInput, type PlanOptions } from './planning';
import { todayISO } from './dates';

const KEY = 'wallet.planning';
export const PLAN_OPTIONS_EVENT = 'wallet:plan-options';

/** Opções da previsão (contas, estimativa, reserva): só preferências, nunca dados financeiros. */
export function loadPlanOptions(): PlanOptions {
  try { return { ...DEFAULT_PLAN_OPTIONS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULT_PLAN_OPTIONS }; }
}
export function savePlanOptions(o: PlanOptions): void {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* sem storage */ }
  window.dispatchEvent(new Event(PLAN_OPTIONS_EVENT));
}

/** O que falta pagar / receber nos grupos partilhados. null = há sessão mas não foi possível saber (sem ligação).
 *  Se fui eu a pagar a despesa toda, a minha parte não é dívida (o dinheiro já saiu). */
async function groupBalances(): Promise<{ oweCents: number; owedToMeCents: number } | null> {
  const sb = getSupabase();
  if (!sb) return { oweCents: 0, owedToMeCents: 0 };
  const { data: sess } = await sb.auth.getSession();
  const me = sess.session?.user.id;
  if (!me) return { oweCents: 0, owedToMeCents: 0 }; // sem conta não há grupos partilhados
  try {
    const bills = await sb.from('split_bills').select('id, created_by').is('deleted_at', null);
    if (bills.error) return null;
    const by = new Map((bills.data ?? []).map((b: { id: string; created_by: string }) => [b.id, b.created_by]));
    if (!by.size) return { oweCents: 0, owedToMeCents: 0 };
    const sh = await sb.from('split_shares').select('bill_id, user_id, share_cents').is('paid_at', null).in('bill_id', [...by.keys()]);
    if (sh.error) return null;
    let owe = 0, owed = 0;
    for (const r of (sh.data ?? []) as Array<{ bill_id: string; user_id: string; share_cents: number }>) {
      const creator = by.get(r.bill_id);
      if (r.user_id === me && creator !== me) owe += Number(r.share_cents);
      if (r.user_id !== me && creator === me) owed += Number(r.share_cents);
    }
    return { oweCents: owe, owedToMeCents: owed };
  } catch { return null; }
}

const live = <T extends { deletedAt: string | null }>(r: T[]) => r.filter((x) => x.deletedAt === null);

export async function loadPlanInput(db: WalletDB, options = loadPlanOptions(), withGroups = true): Promise<PlanInput> {
  const [accounts, txs, transfers, salaries, recurrings, budgets, goals] = await Promise.all([
    db.accounts.toArray(), db.transactions.toArray(), db.transfers.toArray(), db.salaries.toArray(), db.recurrings.toArray(), db.budgets.toArray(), db.goals.toArray(),
  ]);
  return {
    today: todayISO(), currency: loadSettings().currency,
    accounts: live(accounts), txs: live(txs), transfers: live(transfers), salaries: live(salaries), recurrings: live(recurrings), budgets: live(budgets), goals: live(goals),
    options, groups: withGroups ? await groupBalances() : { oweCents: 0, owedToMeCents: 0 },
  };
}
