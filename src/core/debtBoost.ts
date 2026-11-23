// Acabar uma dívida mais depressa: quanto dá para abater a mais sem apertar a pessoa, e o que isso poupa em tempo e juros.
// Tudo puro (sem base de dados). Ideia base: usa-se só uma parte do que costuma sobrar e fica sempre dinheiro para poupar.
import type { Account, Transaction, Transfer } from '../db/database';
import { payoff } from './debtPlan';

export interface Effect { months: number; saveMonths: number; saveInterestCents: number }
/** Efeito de pagar `nowCents` já e passar a abater `monthlyCents` por mês. null = com estes valores a dívida não acaba. */
export function simulate(left: number, base: number, rate: number, nowCents: number, monthlyCents: number): Effect | null {
  const a = payoff(left, base, rate), b = payoff(Math.max(0, left - nowCents), monthlyCents, rate);
  if (!b) return null;
  return { months: b.months, saveMonths: a ? Math.max(0, a.months - b.months) : 0, saveInterestCents: a ? Math.max(0, a.totalCents - left - (b.totalCents - Math.max(0, left - nowCents))) : 0 };
}

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const round = (c: number, step: number) => Math.floor(c / step) * step;

export interface Budget {
  months: number; // meses fechados com movimentos que entraram nas contas
  incomeCents: number; spendCents: number; // num mês normal
  debtCents: number; // o que já vai para dívidas por mês
  freeCents: number; // o que sobra depois das contas e das dívidas
  extraCents: number; // quanto se pode abater a mais por mês (metade do que sobra, no máximo)
  keepCents: number; // o que fica sempre para poupar
  lumpCents: number; // quanto se pode pagar já, deixando 3 meses de despesas de lado
}

/** Um mês normal da pessoa (últimos 6 meses fechados) e o que dá para abater a mais sem risco. */
export function budget(txs: Transaction[], transfers: Transfer[], accounts: Account[], liquidCents: number, now = new Date()): Budget {
  const debts = new Set(accounts.filter((a) => a.type === 'debt').map((a) => a.id));
  const keys = Array.from({ length: 6 }, (_, i) => ym(new Date(now.getFullYear(), now.getMonth() - 1 - i, 1)));
  const rows = keys.map((k) => {
    const m = txs.filter((t) => t.deletedAt === null && t.date.startsWith(k));
    return {
      n: m.length,
      inc: m.filter((t) => t.type === 'income').reduce((a, t) => a + t.amountCents, 0),
      exp: m.filter((t) => t.type === 'expense' && !t.transferId).reduce((a, t) => a + t.amountCents, 0),
      debt: transfers.filter((t) => t.deletedAt === null && t.date.startsWith(k) && debts.has(t.toAccountId)).reduce((a, t) => a + t.amountCents, 0),
    };
  }).filter((r) => r.n > 0 && r.inc > 0);
  if (rows.length < 2) return { months: rows.length, incomeCents: 0, spendCents: 0, debtCents: 0, freeCents: 0, extraCents: 0, keepCents: 0, lumpCents: 0 };
  const incomeCents = median(rows.map((r) => r.inc)), spendCents = median(rows.map((r) => r.exp)), debtCents = median(rows.map((r) => r.debt));
  const free = rows.map((r) => r.inc - r.exp - r.debt), sorted = [...free].sort((a, b) => a - b);
  // o mais prudente entre o mês do meio e um mês fraco
  const weak = sorted[Math.floor((sorted.length - 1) / 4)], freeCents = Math.max(0, Math.round((median(free) + weak) / 2));
  const extraCents = round(freeCents / 2, 500);
  return { months: rows.length, incomeCents, spendCents, debtCents, freeCents, extraCents, keepCents: freeCents - extraCents, lumpCents: Math.max(0, round((liquidCents - (spendCents + debtCents) * 3) / 2, 5000)) };
}

/** Quanto se abate hoje por mês: o valor combinado ou a média do que tem sido pago. */
export function usualPayment(planMonthly: number, accId: string, transfers: Transfer[], now = new Date()): number {
  if (planMonthly > 0) return planMonthly;
  const keys = Array.from({ length: 6 }, (_, i) => ym(new Date(now.getFullYear(), now.getMonth() - 1 - i, 1)));
  const v = keys.map((k) => transfers.filter((t) => t.deletedAt === null && t.toAccountId === accId && t.date.startsWith(k)).reduce((a, t) => a + t.amountCents, 0)).filter((x) => x > 0);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
}

export interface Option { extra: number; monthly: number; effect: Effect }
/** Três formas de acabar mais cedo: leve, equilibrada e a mais rápida dentro do que é seguro. */
export function options(left: number, base: number, rate: number, b: Budget): Option[] {
  const out: Option[] = [];
  for (const k of [0.35, 0.65, 1]) {
    const extra = round(b.extraCents * k, 500), effect = extra > 0 ? simulate(left, base, rate, 0, base + extra) : null;
    if (effect && !out.some((o) => o.extra === extra)) out.push({ extra, monthly: base + extra, effect });
  }
  return out;
}
