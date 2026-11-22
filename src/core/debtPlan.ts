// Plano de uma conta de poupança ou dívida: quanto por mês, juros, quanto devia no início e a meta ligada.
// Vai guardado no fim da descrição da conta, que já é sincronizada: não precisa de colunas novas na nuvem.
import type { Account, Transfer } from '../db/database';

export interface DebtPlan { monthlyCents: number; startCents: number; rate?: number; goalId?: string } // rate = juro por ano, em %
const SEP = '⁣plan:'; // separador invisível

export function splitDesc(desc: string | undefined): { text: string; plan: DebtPlan | null } {
  const raw = desc ?? '', i = raw.indexOf(SEP);
  if (i < 0) return { text: raw, plan: null };
  const text = raw.slice(0, i), p = raw.slice(i + SEP.length).split(':');
  if (p.length < 2 || !/^\d+$/.test(p[0]) || !/^\d+$/.test(p[1])) return { text, plan: null };
  const rate = Number(p[2] || 0);
  return { text, plan: { monthlyCents: Number(p[0]), startCents: Number(p[1]), ...(rate > 0 ? { rate } : {}), ...(p[3] ? { goalId: p[3] } : {}) } };
}

export function joinDesc(text: string, plan: DebtPlan | null): string {
  const clean = text.replace(/⁣.*$/s, '').trim();
  return plan ? `${clean}${SEP}${plan.monthlyCents}:${plan.startCents}:${plan.rate ?? ''}:${plan.goalId ?? ''}` : clean;
}

const i = (p: DebtPlan | null) => (p?.rate && p.monthlyCents > 0 ? p.rate / 1200 : 0); // juro do mês

/** Quanto falta da dívida depois de pagar `paid`: com juros, parte de cada prestação é juro e não baixa a dívida. */
export function afterPayments(owed: number, paid: number, plan: DebtPlan | null): number {
  const k = i(plan);
  if (!k || paid <= 0) return owed - paid;
  let b = owed, p = paid;
  for (let n = 0; n < 2400 && p > 0 && b > 0; n++) { const x = Math.min(p, plan!.monthlyCents); b += b * k * (x / plan!.monthlyCents) - x; p -= x; }
  return Math.round(b);
}

/** O contrário: quanto devia no início para, depois de pagar `paid`, dever `left`. */
export function beforePayments(left: number, paid: number, plan: DebtPlan | null): number {
  const k = i(plan);
  if (!k || paid <= 0) return left + paid;
  const full = Math.floor(paid / plan!.monthlyCents), rest = paid - full * plan!.monthlyCents;
  let b = left;
  if (rest > 0) b = (b + rest) / (1 + k * (rest / plan!.monthlyCents));
  for (let n = 0; n < Math.min(full, 2400); n++) b = (b + plan!.monthlyCents) / (1 + k);
  return Math.round(b);
}

/** Em quantos meses acaba e quanto se paga ao todo. null = com este valor nunca acaba. */
export function payoff(left: number, monthly: number, rate = 0): { months: number; totalCents: number } | null {
  if (left <= 0) return { months: 0, totalCents: 0 };
  const k = rate / 1200;
  if (monthly <= 0 || monthly <= left * k) return null;
  let b = left, total = 0, n = 0;
  while (b > 0.5 && n < 2400) { b += b * k; const x = Math.min(b, monthly); b -= x; total += x; n++; }
  return b > 0.5 ? null : { months: n, totalCents: Math.round(total) };
}

/** Valor de uma conta para uma meta: dinheiro que tem ou, numa dívida, o que já foi abatido. */
export const goalValueCents = (a: Account, bal: number) => (a.type === 'debt' ? Math.max(0, (splitDesc(a.description).plan?.startCents ?? a.initialBalanceCents) - bal) : bal);

export interface DebtStatus { left: number; start: number; paid: number; ratio: number; monthly: number; rate: number; inThisMonth: number; months: number | null; totalCents: number | null }

/** Como está a dívida: quanto já foi abatido, quanto entrou este mês e quando acaba a este ritmo (com juros, se houver). */
export function debtStatus(a: Account, balCents: number, transfers: Transfer[], now: Date): DebtStatus {
  const plan = splitDesc(a.description).plan;
  const left = Math.max(0, balCents), start = Math.max(left, plan?.startCents ?? a.initialBalanceCents);
  const monthly = plan?.monthlyCents ?? 0, rate = plan?.rate ?? 0, po = payoff(left, monthly, rate);
  return { left, start, paid: start - left, ratio: start > 0 ? (start - left) / start : 1, monthly, rate, inThisMonth: inThisMonth(a, transfers, now), months: po?.months ?? null, totalCents: po?.totalCents ?? null };
}

/** Transferências que entraram na conta este mês. */
export function inThisMonth(a: Account, transfers: Transfer[], now: Date): number {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return transfers.filter((t) => t.deletedAt === null && t.toAccountId === a.id && t.date.startsWith(month)).reduce((s, t) => s + t.amountCents, 0);
}
