// Cada salário (página Salários) aparece também como uma transação de rendimento, para entrar nas Transações,
// na Visão mensal, etc. A transação tem id fixo "sal-<id do salário>": todos os aparelhos geram a mesma linha
// (a sincronização não a duplica) e não é preciso nenhuma coluna nova no Supabase.
//
// Os cálculos que já somam os salários à parte (Painel, saldos das contas, resumo do período…) ignoram estas
// transações com isSalaryTx, para o salário não contar a dobrar.
import type { WalletDB, Transaction, Salary } from '../db/database';
import { defaultAccountId } from './accounts';
import { loadSettings } from './settings';

export const SALARY_TX_PREFIX = 'sal-';
export const isSalaryTx = (t: { id: string }): boolean => t.id.startsWith(SALARY_TX_PREFIX);
export const withoutSalaryTx = <T extends { id: string }>(rows: T[]): T[] => rows.filter((t) => !isSalaryTx(t));

const pad = (n: number) => String(n).padStart(2, '0');

/** O que a transação de um salário deve ter (ou null se o salário não existe/é zero). */
export function salaryTxFor(s: Salary, opts: { categoryId: string; currency: string; accountId?: string; description: string }): Omit<Transaction, 'createdAt' | 'updatedAt'> | null {
  if (s.deletedAt !== null || !(s.amountCents > 0)) return null;
  return {
    id: SALARY_TX_PREFIX + s.id,
    date: `${s.year}-${pad(s.month)}-01`,
    type: 'income',
    categoryId: opts.categoryId,
    description: opts.description,
    amountCents: s.amountCents,
    currency: opts.currency,
    accountId: opts.accountId,
    deletedAt: null,
  };
}

/** Acerta as transações dos salários com a tabela de salários (cria, atualiza ou apaga). */
const SALARY_WORD: Record<string, string> = { 'pt-PT': 'Salário', 'pt-BR': 'Salário', en: 'Salary', es: 'Salario', fr: 'Salaire' };

export async function syncSalaryTransactions(db: WalletDB, currency?: string, description?: string): Promise<void> {
  const st = loadSettings();
  currency = currency ?? st.currency;
  description = description ?? SALARY_WORD[st.language] ?? 'Salary';
  const [salaries, cats, accounts] = await Promise.all([db.salaries.toArray(), db.categories.toArray(), db.accounts.toArray()]);
  const cat = cats.find((c) => c.deletedAt === null && c.nameKey === 'catSalary') ?? cats.find((c) => c.deletedAt === null && c.nameKey === 'catOtherIncome');
  if (!cat) return;
  const accountId = defaultAccountId(accounts.filter((a) => a.deletedAt === null)) ?? undefined;
  const now = new Date().toISOString();
  // um salário por mês: se houver repetidos (ex.: criados em 2 aparelhos), só o mais recente conta
  const latest = new Map<string, Salary>();
  for (const s of salaries) {
    if (s.deletedAt !== null) continue;
    const k = `${s.year}-${s.month}`;
    const cur = latest.get(k);
    if (!cur || s.updatedAt > cur.updatedAt) latest.set(k, s);
  }
  const keep = new Set([...latest.values()].map((s) => s.id));
  await db.transaction('rw', db.transactions, async () => {
    for (const s of salaries) {
      const id = SALARY_TX_PREFIX + s.id;
      const existing = await db.transactions.get(id);
      const want = keep.has(s.id) ? salaryTxFor(s, { categoryId: existing?.categoryId ?? cat.id, currency: currency!, accountId: existing?.accountId ?? accountId, description: existing?.description || description! }) : null;
      if (!want) {
        if (existing && existing.deletedAt === null) await db.transactions.update(id, { deletedAt: now, updatedAt: now });
        continue;
      }
      if (!existing) { await db.transactions.add({ ...want, createdAt: now, updatedAt: now }); continue; }
      if (existing.deletedAt !== null || existing.amountCents !== want.amountCents || existing.date !== want.date) {
        await db.transactions.update(id, { amountCents: want.amountCents, date: want.date, deletedAt: null, updatedAt: now });
      }
    }
  });
}

/** Apagar a transação de um salário nas Transações apaga também o salário (senão voltava a aparecer). */
export async function deleteSalaryOfTx(db: WalletDB, txId: string): Promise<void> {
  if (!txId.startsWith(SALARY_TX_PREFIX)) return;
  const sid = txId.slice(SALARY_TX_PREFIX.length);
  const now = new Date().toISOString();
  const s = await db.salaries.get(sid);
  if (s && s.deletedAt === null) await db.salaries.update(sid, { deletedAt: now, updatedAt: now });
}
