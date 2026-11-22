// Plano de uma dívida: quanto a pessoa conta abater por mês e quanto devia no início (para a barra de progresso).
// Vai guardado no fim da descrição da conta, que já é sincronizada: não precisa de colunas novas na nuvem.
import type { Account, Transfer } from '../db/database';

export interface DebtPlan { monthlyCents: number; startCents: number }
const SEP = '⁣plan:'; // separador invisível

export function splitDesc(desc: string | undefined): { text: string; plan: DebtPlan | null } {
  const raw = desc ?? '', i = raw.indexOf(SEP);
  if (i < 0) return { text: raw, plan: null };
  const m = /^(\d+):(\d+)$/.exec(raw.slice(i + SEP.length));
  return { text: raw.slice(0, i), plan: m ? { monthlyCents: Number(m[1]), startCents: Number(m[2]) } : null };
}

export const joinDesc = (text: string, plan: DebtPlan | null) => text.replace(/⁣.*$/s, '').trim() + (plan ? `${SEP}${plan.monthlyCents}:${plan.startCents}` : '');

export interface DebtStatus { left: number; start: number; paid: number; ratio: number; monthly: number; paidThisMonth: number; months: number | null; end: Date | null }

/** Como está a dívida: quanto já foi abatido, quanto já se abateu este mês e quando acaba a este ritmo (sem contar juros). */
export function debtStatus(a: Account, balCents: number, transfers: Transfer[], now: Date): DebtStatus {
  const plan = splitDesc(a.description).plan;
  const left = Math.max(0, balCents);
  const start = Math.max(left, plan?.startCents ?? a.initialBalanceCents);
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const paidThisMonth = transfers.filter((t) => t.deletedAt === null && t.toAccountId === a.id && t.date.startsWith(month)).reduce((s, t) => s + t.amountCents, 0);
  const monthly = plan?.monthlyCents ?? 0;
  const months = left === 0 ? 0 : monthly > 0 ? Math.ceil(left / monthly) : null;
  return {
    left, start, paid: start - left, ratio: start > 0 ? (start - left) / start : 1, monthly, paidThisMonth, months,
    end: months === null ? null : new Date(now.getFullYear(), now.getMonth() + months, 1),
  };
}
