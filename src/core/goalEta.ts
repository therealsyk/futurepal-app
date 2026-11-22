// Quanto entra numa meta por mês e quando se chega lá (página Metas e widget).
import type { Account, Goal, Salary, Transaction, Transfer } from '../db/database';
import { accountBalanceCents } from './accounts';
import { goalValueCents, splitDesc } from './debtPlan';
import { forecastGoal } from './goalForecast';

export interface GoalData { txs: Transaction[]; accounts: Account[]; transfers: Transfer[]; salaries: Salary[] }

/** Quanto entrou na meta em cada um dos últimos 8 meses (o último é o mês atual). */
export function goalMonthlyIn(g: Goal, d: GoalData, now: Date): number[] {
  const keys = Array.from({ length: 8 }, (_, i) => { const dt = new Date(now.getFullYear(), now.getMonth() - 7 + i, 1); return { y: dt.getFullYear(), m: dt.getMonth() + 1 }; });
  const ym = (k: { y: number; m: number }) => `${k.y}-${String(k.m).padStart(2, '0')}`;
  if (g.accountIds?.length) {
    // conta(s) ligadas: o que mudou no saldo de mês para mês
    const endBal = (k: { y: number; m: number }) => {
      const last = new Date(k.y, k.m, 0).toISOString().slice(0, 10);
      const sal = d.salaries.filter((x) => x.year * 100 + x.month <= k.y * 100 + k.m).reduce((a, x) => a + x.amountCents, 0);
      return d.accounts.filter((a) => g.accountIds!.includes(a.id)).reduce((sum, a) => sum + goalValueCents(a, accountBalanceCents(a, d.txs.filter((t) => t.date <= last), d.accounts, sal, d.transfers.filter((t) => t.date <= last))), 0);
    };
    const prev = new Date(now.getFullYear(), now.getMonth() - 8, 1);
    const bals = [endBal({ y: prev.getFullYear(), m: prev.getMonth() + 1 }), ...keys.map(endBal)];
    return keys.map((_, i) => bals[i + 1] - bals[i]);
  }
  if (g.contributions?.length) return keys.map((k) => g.contributions!.filter((c) => c.date.startsWith(ym(k))).reduce((a, c) => a + c.cents, 0));
  // metas antigas sem histórico: reparte o que já tem pelos meses desde o início
  const since = Math.max(1, (now.getFullYear() - +g.startDate.slice(0, 4)) * 12 + now.getMonth() + 1 - +g.startDate.slice(5, 7));
  return keys.map((_, i) => (i >= 8 - Math.min(8, since + 1) && i < 7 ? Math.round(g.currentCents / since) : 0));
}

/** Daqui a quantos meses se chega ao objetivo (valor certo por mês ou ritmo habitual). null = não dá para prever. */
export function goalEtaMonths(g: Goal, cur: number, d: GoalData, now: Date): number | null {
  const left = Math.max(0, g.targetCents - cur);
  if (left === 0) return 0;
  const m = splitDesc(g.notes).plan?.monthlyCents ?? 0;
  if (m > 0) return Math.ceil(left / m);
  return forecastGoal(goalMonthlyIn(g, d, now), left, now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).etaMonths;
}
