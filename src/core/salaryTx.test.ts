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

describe('rendimentos na categoria Salário vão para a aba Salários', () => {
  const salaryCat = async () => (await db.categories.toArray()).find((c) => c.nameKey === 'catSalary')!.id;
  it('cria o salário do mês e não duplica quando o mês já tem o mesmo salário', async () => {
    const cat = await salaryCat();
    const now = new Date().toISOString();
    const add = (id: string, date: string, cents: number) => db.transactions.add({ id, date, type: 'income', categoryId: cat, description: 'ACME', amountCents: cents, currency: 'EUR', createdAt: now, updatedAt: now, deletedAt: null });
    await add('a', '2026-10-27', 145000); // mês sem salário -> passa para Salários
    await setSalary(db, 2026, 9, 140000);
    await add('b', '2026-09-26', 140000); // igual ao salário de setembro -> repetido, sai
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    const live = (await db.transactions.toArray()).filter((t) => t.deletedAt === null);
    expect(live.map((t) => [t.date, t.amountCents]).sort()).toEqual([['2026-09-01', 140000], ['2026-10-01', 145000]]);
    expect(live.every(isSalaryTx)).toBe(true);
    const sal = (await db.salaries.toArray()).filter((s) => s.deletedAt === null).map((s) => [s.month, s.amountCents]).sort();
    expect(sal).toEqual([[10, 145000], [9, 140000]].sort());
  });
});

describe('salários repetidos no mesmo mês', () => {
  it('syncSalaryTransactions apaga o repetido mais antigo e setSalary não soma', async () => {
    const { createDatabase } = await import('../db/database');
    const { setSalary, salaryGrid } = await import('./finance');
    const db = createDatabase('sal-dup-' + Date.now());
    await db.categories.put({ id: 'cat-catSalary', name: 'catSalary', nameKey: 'catSalary', color: '#000', icon: '', order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null });
    await db.salaries.put({ id: 'a', year: 2026, month: 11, amountCents: 50000, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', deletedAt: null });
    await db.salaries.put({ id: 'b', year: 2026, month: 11, amountCents: 50000, createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', deletedAt: null });
    await setSalary(db, 2026, 11, 50000);
    await syncSalaryTransactions(db, 'EUR', 'Salário');
    const grid = await salaryGrid(db, 2026);
    expect(grid.find((g) => g.month === 11)?.amountCents).toBe(50000);
    expect((await db.salaries.toArray()).filter((s) => s.deletedAt === null)).toHaveLength(1);
  });
});
