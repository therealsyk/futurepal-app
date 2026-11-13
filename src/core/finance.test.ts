import 'fake-indexeddb/auto';
import { describe, it, beforeEach, expect } from 'vitest';
import { createDatabase, seedDefaults } from '../db/database';
import type { WalletDB } from '../db/database';
import {
  addTransaction,
  monthTransactions,
  totalsByCategory,
  monthSummary,
  budgetUsage,
  setBudget,
} from './finance';

let db: WalletDB;

beforeEach(async () => {
  db = createDatabase('test-' + Math.random().toString(36).slice(2));
  await seedDefaults(db);
});

describe('finance core', () => {
  it('rejects invalid transaction amounts and dates', async () => {
    const cats = await db.categories.toArray();
    const foodId = cats.find((c) => c.name === 'Alimentação')!.id!;
    await expect(addTransaction(db, { date: '2026-01-10', description: 'x', amount: 0, categoryId: foodId })).rejects.toThrow();
    await expect(addTransaction(db, { date: '10/01/2026', description: 'y', amount: 5, categoryId: foodId })).rejects.toThrow();
    const count = await db.transactions.count();
    if (count !== 0) throw new Error(`expected 0 transactions, got ${count}`);
  });

  it('adds transactions and computes month summary (income vs expenses)', async () => {
    const cats = await db.categories.toArray();
    const salaryId = cats.find((c) => c.name === 'Salário')!.id!;
    const foodId = cats.find((c) => c.name === 'Alimentação')!.id!;
    await addTransaction(db, { date: '2026-01-05', description: 'salário', amount: 1000, categoryId: salaryId });
    await addTransaction(db, { date: '2026-01-12', description: 'supermercado', amount: -120, categoryId: foodId });
    await addTransaction(db, { date: '2026-02-03', description: 'salário feb', amount: 1100, categoryId: salaryId });

    const jan = await monthSummary(db, 2026, 1);
    if (jan.income !== 1000 || jan.expenses !== 120 || jan.net !== 880) {
      throw new Error(`Jan summary wrong: ${JSON.stringify(jan)}`);
    }
    const feb = await monthSummary(db, 2026, 2);
    if (feb.income !== 1100 || feb.expenses !== 0 || feb.net !== 1100) {
      throw new Error(`Feb summary wrong: ${JSON.stringify(feb)}`);
    }
    const janTxs = await monthTransactions(db, 2026, 1);
    if (janTxs.length !== 2) throw new Error(`expected 2 Jan txs, got ${janTxs.length}`);
  });

  it('totals by category include only that month', async () => {
    const cats = await db.categories.toArray();
    const salaryId = cats.find((c) => c.name === 'Salário')!.id!;
    const foodId = cats.find((c) => c.name === 'Alimentação')!.id!;
    const transportId = cats.find((c) => c.name === 'Transporte')!.id!;
    await addTransaction(db, { date: '2026-03-01', description: 'salário', amount: 1067.21, categoryId: salaryId });
    await addTransaction(db, { date: '2026-03-10', description: 'comida', amount: -50, categoryId: foodId });
    await addTransaction(db, { date: '2026-03-11', description: 'comboio', amount: -20, categoryId: transportId });

    const totals = await totalsByCategory(db, 2026, 3);
    const byName = new Map(totals.map((t) => [t.name, t.total]));
    if (byName.get('Salário') !== 1067.21) throw new Error('salary total wrong');
    if (byName.get('Alimentação') !== -50) throw new Error('food total wrong');
    if (byName.get('Transporte') !== -20) throw new Error('transport total wrong');
    if (byName.get('Lazer') !== 0) throw new Error('lazer should be 0');
  });

  it('budget usage detects over-budget with monthly override', async () => {
    const cats = await db.categories.toArray();
    const foodId = cats.find((c) => c.name === 'Alimentação')!.id!;
    await setBudget(db, foodId, 100); // global limit
    await setBudget(db, foodId, 80, 4, 2026); // April override
    await addTransaction(db, { date: '2026-04-15', description: 'comida', amount: -90, categoryId: foodId });

    const usage = await budgetUsage(db, foodId, 2026, 4);
    if (usage.limit !== 80) throw new Error(`expected override limit 80, got ${usage.limit}`);
    if (usage.spent !== 90) throw new Error(`expected spent 90, got ${usage.spent}`);
    if (!usage.overBudget) throw new Error('should be over budget');
    if (usage.remaining !== -10) throw new Error(`remaining should be -10, got ${usage.remaining}`);

    // update existing override
    await setBudget(db, foodId, 120, 4, 2026);
    const usage2 = await budgetUsage(db, foodId, 2026, 4);
    if (usage2.limit !== 120) throw new Error(`limit update failed: ${usage2.limit}`);
    if (usage2.overBudget) throw new Error('should no longer be over budget');
  });
});
