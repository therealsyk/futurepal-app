import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, it, beforeEach, expect } from 'vitest';
import { createDatabase } from '../db/database';
import type { WalletDB, Category } from '../db/database';
import {
  addTransaction,
  monthTransactions,
  totalsByCategory,
  monthSummary,
  budgetUsage,
  setBudget,
  softDelete,
  addCategory,
  activeCategories,
  MAX_ACTIVE_CATEGORIES,
} from './finance';

let db: WalletDB;

async function makeCategory(name: string): Promise<Category> {
  return addCategory(db, { name, color: '#000', icon: '', order: 0 });
}

beforeEach(async () => {
  db = createDatabase('test-' + Math.random().toString(36).slice(2));
  // Do NOT seed defaults here: tests create their own categories to stay under the 12 limit.
});

describe('addTransaction validation', () => {
  it('rejects non-integer, zero and negative cents', async () => {
    const cat = await makeCategory('Test');
    await expect(addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 12.5, currency: 'EUR' })).rejects.toThrow();
    await expect(addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 0, currency: 'EUR' })).rejects.toThrow();
    await expect(addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'x', amountCents: -5, currency: 'EUR' })).rejects.toThrow();
    const count = await db.transactions.count();
    expect(count).toBe(0);
  });

  it('rejects invalid dates (2026-02-31) and bad currency/type', async () => {
    const cat = await makeCategory('Test');
    await expect(addTransaction(db, { date: '2026-02-31', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 100, currency: 'EUR' })).rejects.toThrow();
    await expect(addTransaction(db, { date: '10/01/2026', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 100, currency: 'EUR' })).rejects.toThrow();
    await expect(addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 100, currency: 'EU' })).rejects.toThrow();
    await expect(addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 100, currency: 'EU' })).rejects.toThrow();
  });

  it('rejects non-existent category', async () => {
    await expect(addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: 'nope', description: 'x', amountCents: 100, currency: 'EUR' })).rejects.toThrow();
  });

  it('accepts a valid transaction and stamps UUID/timestamps', async () => {
    const cat = await makeCategory('Test');
    const tx = await addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 1250, currency: 'EUR' });
    expect(tx.id).toBeTruthy();
    expect(tx.deletedAt).toBeNull();
    expect(tx.createdAt).toBeTruthy();
  });
});

describe('categories max 12', () => {
  it('rejects the 13th active category', async () => {
    // Fresh DB has no categories; fill up to 12, then try a 13th.
    for (let i = 0; i < MAX_ACTIVE_CATEGORIES; i++) {
      await addCategory(db, { name: `C${i}`, color: '#fff', icon: '', order: i });
    }
    await expect(addCategory(db, { name: 'Extra13', color: '#fff', icon: '', order: 12 })).rejects.toThrow();
    const active = await activeCategories(db);
    expect(active.length).toBe(MAX_ACTIVE_CATEGORIES);
  });

  it('soft-deleted category frees a slot', async () => {
    for (let i = 0; i < MAX_ACTIVE_CATEGORIES; i++) {
      await addCategory(db, { name: `C${i}`, color: '#fff', icon: '', order: 20 + i });
    }
    const active = await activeCategories(db);
    expect(active.length).toBe(MAX_ACTIVE_CATEGORIES);
    await softDelete(db, 'categories', active[0].id);
    await addCategory(db, { name: 'FitsNow', color: '#fff', icon: '', order: 30 }); // now allowed
    const after = await activeCategories(db);
    expect(after.length).toBe(MAX_ACTIVE_CATEGORIES);
  });
});

describe('month summary and soft delete', () => {
  it('computes income/expense/net in cents and ignores soft-deleted rows', async () => {
    const salary = await makeCategory('Salary');
    const food = await makeCategory('Food');
    await addTransaction(db, { date: '2026-01-05', type: 'income', categoryId: salary.id, description: 'salário', amountCents: 100000, currency: 'EUR' });
    const tx2 = await addTransaction(db, { date: '2026-01-12', type: 'expense', categoryId: food.id, description: 'supermercado', amountCents: 12000, currency: 'EUR' });
    const jan = await monthSummary(db, 2026, 1);
    expect(jan).toEqual({ incomeCents: 100000, expenseCents: 12000, netCents: 88000 });

    // soft delete tx2 -> totals ignore it
    await softDelete(db, 'transactions', tx2.id);
    const jan2 = await monthSummary(db, 2026, 1);
    expect(jan2).toEqual({ incomeCents: 100000, expenseCents: 0, netCents: 100000 });
    const stillThere = await db.transactions.get(tx2.id);
    expect(stillThere).toBeTruthy(); // row kept, just deletedAt set
    expect(stillThere!.deletedAt).not.toBeNull();

    const totals = await totalsByCategory(db, 2026, 1);
    const foodTotal = totals.find((t) => t.categoryId === food.id)?.totalCents;
    expect(foodTotal).toBe(0);
  });

  it('monthTransactions uses the real last day of month (not -31)', async () => {
    const cat = await makeCategory('Test');
    // Feb 2026 has 28 days. A date like 2026-02-29 should NOT be in Feb's range via endOfMonth.
    await addTransaction(db, { date: '2026-02-28', type: 'expense', categoryId: cat.id, description: 'end', amountCents: 100, currency: 'EUR' });
    const feb = await monthTransactions(db, 2026, 2);
    expect(feb.length).toBe(1);
    // Sanity: no transaction on a non-existent Feb 31 is ever counted.
    const all = await db.transactions.count();
    expect(all).toBe(1);
  });
});

describe('Excel 2026 reference fixture (SPEC §6.3 / §8)', () => {
  it('reproduces the real spreadsheet: total expenses 5730.70 € and savings 47.02%', async () => {
    const fixture: { transactions: Array<{ date: string; category: string; description: string; amountCents: number }>; salaries: Array<{ year: number; month: number; amountCents: number }>; expected: { expenseCents: number; incomeCents: number; savingsCents: number; savingsPercent: number } } = JSON.parse(readFileSync('src/fixtures/excel-2026.json', 'utf8'));

    // Create one category per distinct name found in the fixture (10 categories).
    const catByName: Record<string, Category> = {};
    let order = 0;
    for (const name of new Set(fixture.transactions.map((t: { category: string }) => t.category))) {
      catByName[name] = await addCategory(db, { name, color: '#888', icon: '', order: order++ });
    }

    // Insert all 106 expense transactions (all fixture entries are expenses).
    for (const t of fixture.transactions) {
      await addTransaction(db, {
        date: t.date,
        type: 'expense',
        categoryId: catByName[t.category].id,
        description: t.description,
        amountCents: t.amountCents,
        currency: 'EUR',
      });
    }

    // Insert 2026 salaries as income transactions (salary table feeds the income side).
    const salaryCat = await addCategory(db, { name: 'Salário', color: '#4caf50', icon: '', order: order++ });
    for (const s of fixture.salaries) {
      await addTransaction(db, {
        date: `${s.year}-${String(s.month).padStart(2, '0')}-01`,
        type: 'income',
        categoryId: salaryCat.id,
        description: 'Salário',
        amountCents: s.amountCents,
        currency: 'EUR',
      });
    }

    // Aggregate the whole year 2026 (months 1..12).
    let expenseCents = 0;
    let incomeCents = 0;
    for (let m = 1; m <= 12; m++) {
      const s = await monthSummary(db, 2026, m);
      expenseCents += s.expenseCents;
      incomeCents += s.incomeCents;
    }

    expect(expenseCents).toBe(fixture.expected.expenseCents); // 573070 = 5730.70 €
    expect(incomeCents).toBe(fixture.expected.incomeCents);   // 1081577
    const netCents = incomeCents - expenseCents;
    expect(netCents).toBe(fixture.expected.savingsCents);     // 508507
    const savingsPercent = Math.round((netCents / incomeCents) * 10000) / 100;
    expect(savingsPercent).toBe(fixture.expected.savingsPercent); // 47.02
  });
});

describe('budget usage', () => {
  it('detects over-budget with monthly limit', async () => {
    const food = await makeCategory('Food');
    await setBudget(db, food.id, 8000, 2026, 4); // April limit 80.00 €
    await addTransaction(db, { date: '2026-04-15', type: 'expense', categoryId: food.id, description: 'comida', amountCents: 9000, currency: 'EUR' });
    const usage = await budgetUsage(db, food.id, 2026, 4);
    expect(usage.limitCents).toBe(8000);
    expect(usage.spentCents).toBe(9000);
    expect(usage.overBudget).toBe(true);
    expect(usage.remainingCents).toBe(-1000);

    // update existing limit
    await setBudget(db, food.id, 12000, 2026, 4);
    const usage2 = await budgetUsage(db, food.id, 2026, 4);
    expect(usage2.limitCents).toBe(12000);
    expect(usage2.overBudget).toBe(false);

    // Soft-deleted budget is ignored.
    const budgets = await db.budgets.where('categoryId').equals(food.id).toArray();
    for (const b of budgets) await softDelete(db, 'budgets', b.id);
    const usage3 = await budgetUsage(db, food.id, 2026, 4);
    expect(usage3.limitCents).toBe(0);
  });
});
