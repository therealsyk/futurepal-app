// Família: contas da casa partilhadas. Lógica pura (sem Supabase) para poder ser testada.
// Cada despesa é paga por uma pessoa e dividida em partes iguais por quem está em splitAmong.

export interface HouseholdMember { userId: string; displayName: string }
export interface HouseholdExpense {
  id: string;
  paidBy: string;
  description: string;
  amountCents: number;
  date: string;
  splitAmong: string[];
  isSettlement: boolean;
  deletedAt: string | null;
}
export interface Debt { from: string; to: string; amountCents: number }

/** Divide em partes iguais em cêntimos; os cêntimos que sobram vão para os primeiros. */
export function splitCents(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Saldo de cada pessoa: positivo = tem a receber, negativo = deve. A soma é sempre 0. */
export function balances(members: HouseholdMember[], expenses: HouseholdExpense[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of members) out[m.userId] = 0;
  for (const e of expenses) {
    if (e.deletedAt || e.amountCents <= 0 || e.splitAmong.length === 0) continue;
    out[e.paidBy] = (out[e.paidBy] ?? 0) + e.amountCents;
    const parts = splitCents(e.amountCents, e.splitAmong.length);
    e.splitAmong.forEach((u, i) => { out[u] = (out[u] ?? 0) - parts[i]; });
  }
  return out;
}

/** Quem paga a quem para ficarem todos acertados, com o menor número de pagamentos (método guloso). */
export function settleUp(bal: Record<string, number>): Debt[] {
  const debtors = Object.entries(bal).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const creditors = Object.entries(bal).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const out: Debt[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    if (amt > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amountCents: amt });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return out;
}

/** Total gasto pela casa (sem contar os acertos de contas). */
export function householdSpent(expenses: HouseholdExpense[], monthPrefix?: string): number {
  return expenses
    .filter((e) => !e.deletedAt && !e.isSettlement && (!monthPrefix || e.date.startsWith(monthPrefix)))
    .reduce((s, e) => s + e.amountCents, 0);
}

export const MAX_MEMBERS = 5;
