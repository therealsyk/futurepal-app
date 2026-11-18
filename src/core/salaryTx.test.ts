import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../db/database';
import type { WalletDB } from '../db/database';
import { ensureDefaultCategories, setSalary, softDelete, periodSummary } from './finance';
import { ensureDefaultAccount } from './accounts';
import { syncSalaryTransactions, isSalaryTx } from './salaryTx';

let db: WalletDB;
beforeEach(async () => {
  db = createDatabase('sal-' + Math.random().toString(36).slice(2));
  await ensureDefaultCategories(db);
  await ensureDefaultAccount(db, 'EUR', 'Main');
});
const salaryTxs = async () => (await db.transactions.toArray()).filter((t) => isSalaryTx(t) && t.deletedAt === null);

describe('salários como transações de rendimento', () => {
  it('cria uma transação de rendimento por salário, no dia 1 do mês, na categoria Salário', async () => {
    await setSalary(db, 2026, 11, 150000);
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    const [tx] = await salaryTxs();
    const cat = await db.categories.get(tx.categoryId);
    expect(tx).toMatchObject({ type: 'income', amountCents: 150000, date: '2026-11-01', description: 'Salário' });
    expect(cat?.nameKey).toBe('catSalary');
  });

  it('atualiza o valor, não duplica e apaga quando o salário fica vazio', async () => {
    await setSalary(db, 2026, 11, 150000);
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    await setSalary(db, 2026, 11, 160000);
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    expect((await salaryTxs()).map((t) => t.amountCents)).toEqual([160000]);
    await setSalary(db, 2026, 11, 0);
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    expect(await salaryTxs()).toEqual([]);
  });

  it('apagar a transação nas Transações apaga o salário; o resumo não conta o salário a dobrar', async () => {
    await setSalary(db, 2026, 11, 100000);
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    const p = await periodSummary(db, '2026-11-01', '2026-11-30');
    expect(p.incomeCents).toBe(100000);
    const [tx] = await salaryTxs();
    await softDelete(db, 'transactions', tx.id);
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    expect(await salaryTxs()).toEqual([]);
    expect((await db.salaries.toArray()).filter((s) => s.deletedAt === null)).toEqual([]);
  });
});
