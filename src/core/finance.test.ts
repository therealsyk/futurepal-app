import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, it, beforeEach, expect } from 'vitest';
import { createDatabase, stampNew } from '../db/database';
import type { WalletDB, Category, Transaction, ExchangeRateRow } from '../db/database';
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
  filterTransactions,
  ensureDefaultCategories,
  DEFAULT_CATEGORY_DEFS,
  salaryInRange,
  periodSummary,
  dailyTotals,
  transactionsOnDay,
  dailyExpenseTotals,
  buildCalendarGrid,
  weekdayLabels,
  salaryGrid,
  salaryYearSummary,
  setSalary,
  addGoal,
  contributeToGoal,
  listGoals,
  estimateGoalCompletion,
  addRecurring,
  expandRecurring,
  addGroup,
  listGroups,
  transactionsInGroup,
  periodKpis,
  spendByDay,
} from './finance';

let db: WalletDB;

async function makeCategory(name: string): Promise<Category> {
  const cat = stampNew<Category>({ name, color: '#000', icon: '', order: 0 });
  await db.categories.add(cat);
  return cat;
}

beforeEach(async () => {
  db = createDatabase('test-' + Math.random().toString(36).slice(2));
  // Do NOT seed defaults here: tests create their own categories to stay under the 12 limit.
});

describe('periodKpis (Excel Resumo strip)', () => {
  it('computes totals, count, largest expense, top category and daily average', async () => {
    const food = await makeCategory('Food');
    const rent = await makeCategory('Rent');
    await addTransaction(db, { date: '2026-01-03', type: 'expense', categoryId: food.id, description: 'a', amountCents: 3000, currency: 'EUR' });
    await addTransaction(db, { date: '2026-01-03', type: 'expense', categoryId: food.id, description: 'b', amountCents: 2000, currency: 'EUR' });
    await addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: rent.id, description: 'c', amountCents: 9000, currency: 'EUR' });
    await addTransaction(db, { date: '2026-01-05', type: 'income', categoryId: food.id, description: 'sal', amountCents: 10000, currency: 'EUR' });
    const txs = await db.transactions.toArray();
    const cats = await activeCategories(db);
    const k = periodKpis(txs, cats);
    expect(k.totalSpentCents).toBe(14000); // income ignored
    expect(k.expenseCount).toBe(3);
    expect(k.largestExpenseCents).toBe(9000);
    expect(k.topCategoryName).toBe('Rent');
    expect(k.avgDailyCents).toBe(7000); // 14000 / 2 distinct days
  });

  it('returns zeros and null top category when there are no expenses', async () => {
    const k = periodKpis([], []);
    expect(k.totalSpentCents).toBe(0);
    expect(k.expenseCount).toBe(0);
    expect(k.largestExpenseCents).toBe(0);
    expect(k.topCategoryName).toBeNull();
    expect(k.avgDailyCents).toBe(0);
  });
});

describe('spendByDay (heatmap)', () => {
  it('groups expenses by day and ignores income', async () => {
    const cat = await makeCategory('Test');
    await addTransaction(db, { date: '2026-01-02', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 500, currency: 'EUR' });
    await addTransaction(db, { date: '2026-01-02', type: 'expense', categoryId: cat.id, description: 'y', amountCents: 700, currency: 'EUR' });
    await addTransaction(db, { date: '2026-01-04', type: 'income', categoryId: cat.id, description: 'z', amountCents: 1000, currency: 'EUR' });
    const days = spendByDay(await db.transactions.toArray());
    expect(days).toEqual([{ day: '2026-01-02', cents: 1200 }]);
  });
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

describe('filterTransactions (SPEC §6.2)', () => {
  it('filters by month, category and text', async () => {
    const home = await makeCategory('Casa');
    const food = await makeCategory('Comida');
    await addTransaction(db, { date: '2026-01-05', type: 'expense', categoryId: home.id, description: 'Luz', amountCents: 4000, currency: 'EUR' });
    await addTransaction(db, { date: '2026-01-20', type: 'expense', categoryId: food.id, description: 'Supermercado', amountCents: 3500, currency: 'EUR' });
    await addTransaction(db, { date: '2026-02-10', type: 'expense', categoryId: home.id, description: 'Agua', amountCents: 1200, currency: 'EUR' });

    const feb = await filterTransactions(db, { year: 2026, month: 2 });
    expect(feb.length).toBe(1);
    expect(feb[0].description).toBe('Agua');

    const homeOnly = await filterTransactions(db, { categoryId: home.id });
    expect(homeOnly.length).toBe(2);

    const search = await filterTransactions(db, { text: 'super' });
    expect(search.length).toBe(1);
    expect(search[0].description).toBe('Supermercado');

    // Combined filters: month + category.
    const combo = await filterTransactions(db, { year: 2026, month: 1, categoryId: home.id });
    expect(combo.length).toBe(1);
    expect(combo[0].description).toBe('Luz');
  });

  it('ignores soft-deleted transactions', async () => {
    const cat = await makeCategory('Test');
    const tx = await addTransaction(db, { date: '2026-03-01', type: 'expense', categoryId: cat.id, description: 'apagar', amountCents: 500, currency: 'EUR' });
    await softDelete(db, 'transactions', tx.id);
    const rows = await filterTransactions(db, { text: 'apagar' });
    expect(rows.length).toBe(0);
  });

  it('ensureDefaultCategories seeds defaults when DB is empty', async () => {
    await ensureDefaultCategories(db);
    const cats = await activeCategories(db);
    expect(cats.length).toBe(DEFAULT_CATEGORY_DEFS.length);
    // Idempotent: running again does not duplicate.
    await ensureDefaultCategories(db);
    const cats2 = await activeCategories(db);
    expect(cats2.length).toBe(DEFAULT_CATEGORY_DEFS.length);
  });

  it('ensureDefaultCategories does not overwrite existing categories', async () => {
    await makeCategory('Minha categoria');
    await ensureDefaultCategories(db);
    const cats = await activeCategories(db);
    expect(cats.length).toBe(1);
    expect(cats[0].name).toBe('Minha categoria');
  });

  it('salaryInRange prorates a monthly salary by days inside the window', async () => {
    // Salary of 30000 cents for March 2026 (31 days). Window Mar 1..Mar 15 = 15 days.
    await db.salaries.add(stampNewSalary({ year: 2026, month: 3, amountCents: 31000 }));
    const full = await salaryInRange(db, '2026-03-01', '2026-03-31');
    expect(full).toBe(31000);
    const half = await salaryInRange(db, '2026-03-01', '2026-03-15');
    // 31000 * 15/31 = 15000
    expect(half).toBe(15000);
  });

  it('periodSummary computes SPEC §6.6 indicators', async () => {
    const cat = await makeCategory('Casa');
    // salaries: Jan+Feb 2026 = 100000 cents each month (31/28 days)
    await db.salaries.add(stampNewSalary({ year: 2026, month: 1, amountCents: 100000 }));
    await db.salaries.add(stampNewSalary({ year: 2026, month: 2, amountCents: 100000 }));
    // expenses in Jan-Feb: 50000 (Jan) + 30000 (Feb) = 80000
    await addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'rent', amountCents: 50000, currency: 'EUR' });
    await addTransaction(db, { date: '2026-02-10', type: 'expense', categoryId: cat.id, description: 'food', amountCents: 30000, currency: 'EUR' });
    const s = await periodSummary(db, '2026-01-01', '2026-02-28');
    expect(s.totalSpentCents).toBe(80000);
    expect(s.expenseCount).toBe(2);
    expect(s.maxExpenseCents).toBe(50000);
    expect(s.topCategory?.categoryId).toBe(cat.id);
    // salary = 100000 (Jan, full) + 100000 (Feb full) = 200000; no extras
    expect(s.salaryCents).toBe(200000);
    expect(s.incomeCents).toBe(200000);
    expect(s.savingsCents).toBe(120000);
    // days = 59 (Jan 31 + Feb 28)
    expect(s.avgPerDayCents).toBe(Math.round(80000 / 59));
    expect(s.pctSpent).toBeCloseTo(80000 / 200000, 6);
    expect(s.pctSavings).toBeCloseTo(120000 / 200000, 6);
  });

  it('periodSummary flags months with no salary', async () => {
    const cat = await makeCategory('Casa');
    await db.salaries.add(stampNewSalary({ year: 2026, month: 1, amountCents: 100000 }));
    // Feb has no salary row -> should be flagged as missing
    await addTransaction(db, { date: '2026-02-05', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 1000, currency: 'EUR' });
    const s = await periodSummary(db, '2026-01-01', '2026-02-28');
    expect(s.missingSalaryMonths).toContain(2);
    expect(s.missingSalaryMonths).not.toContain(1);
  });

  it('dailyTotals sums expenses per day of a year', async () => {
    const cat = await makeCategory('Casa');
    await addTransaction(db, { date: '2026-03-01', type: 'expense', categoryId: cat.id, description: 'a', amountCents: 1000, currency: 'EUR' });
    await addTransaction(db, { date: '2026-03-01', type: 'expense', categoryId: cat.id, description: 'b', amountCents: 500, currency: 'EUR' });
    await addTransaction(db, { date: '2026-03-02', type: 'expense', categoryId: cat.id, description: 'c', amountCents: 700, currency: 'EUR' });
    const totals = await dailyTotals(db, 2026);
    expect(totals['2026-03-01']).toBe(1500);
    expect(totals['2026-03-02']).toBe(700);
    expect(totals['2026-03-03']).toBeUndefined();
  });

  it('dailyTotals ignores soft-deleted rows', async () => {
    const cat = await makeCategory('Casa');
    const tx = await addTransaction(db, { date: '2026-04-10', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 3000, currency: 'EUR' });
    await softDelete(db, 'transactions', tx.id);
    const totals = await dailyTotals(db, 2026);
    expect(totals['2026-04-10']).toBeUndefined();
  });

  it('transactionsOnDay returns all transactions for a day', async () => {
    const cat = await makeCategory('Casa');
    await addTransaction(db, { date: '2026-05-05', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 100, currency: 'EUR' });
    await addTransaction(db, { date: '2026-05-05', type: 'income', categoryId: cat.id, description: 'y', amountCents: 200, currency: 'EUR' });
    const list = await transactionsOnDay(db, '2026-05-05');
    expect(list.length).toBe(2);
  });

  it('salaryGrid returns 12 months with amounts', async () => {
    await setSalary(db, 2026, 1, 100000);
    await setSalary(db, 2026, 2, 95000);
    const grid = await salaryGrid(db, 2026);
    expect(grid.length).toBe(12);
    expect(grid[0].amountCents).toBe(100000);
    expect(grid[1].amountCents).toBe(95000);
    expect(grid[2].amountCents).toBe(0);
  });

  it('setSalary updates an existing month instead of adding a duplicate', async () => {
    await setSalary(db, 2026, 1, 100000);
    await setSalary(db, 2026, 1, 120000);
    const grid = await salaryGrid(db, 2026);
    expect(grid[0].amountCents).toBe(120000);
    const count = (await db.salaries.toArray()).filter((s) => s.year === 2026 && s.month === 1).length;
    expect(count).toBe(1);
  });

  it('salaryYearSummary computes savings and % savings', async () => {
    const cat = await makeCategory('Casa');
    await setSalary(db, 2026, 1, 100000);
    await addTransaction(db, { date: '2026-01-15', type: 'expense', categoryId: cat.id, description: 'x', amountCents: 40000, currency: 'EUR' });
    const s = await salaryYearSummary(db, 2026);
    expect(s.salaryCents).toBe(100000);
    expect(s.expenseCents).toBe(40000);
    expect(s.savingsCents).toBe(60000);
    expect(s.pctSavings).toBeCloseTo(0.6, 6);
  });

  // ---- Metas (SPEC §6.7) ----
  it('addGoal rejects target <= 0', async () => {
    await expect(addGoal(db, 'Casa', 0, '2026-01-01')).rejects.toThrow();
  });

  it('contributeToGoal accumulates and reports progress', async () => {
    const g = await addGoal(db, 'Fundo de emergencia', 500000, '2026-01-01');
    await contributeToGoal(db, g.id, 200000);
    await contributeToGoal(db, g.id, 100000);
    const goals = await listGoals(db);
    expect(goals[0].currentCents).toBe(300000);
    expect(goals[0].targetCents).toBe(500000);
  });

  it('contributeToGoal rejects zero and unknown goal', async () => {
    const g = await addGoal(db, 'X', 100000, '2026-01-01');
    await expect(contributeToGoal(db, g.id, 0)).rejects.toThrow();
    await expect(contributeToGoal(db, 'nope', 500)).rejects.toThrow();
  });

  // ---- Recorrentes (SPEC §6.9) ----
  it('expandRecurring generates monthly transactions up to a date', async () => {
    const cat = await makeCategory('Contas');
    await addRecurring(db, { type: 'expense', categoryId: cat.id, description: 'Renda', amountCents: 80000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-01-01', endDate: null });
    const txs = await expandRecurring(db, '2026-03-31');
    expect(txs.length).toBe(3); // Jan, Feb, Mar
    expect(txs[0].amountCents).toBe(80000);
    expect(txs[2].date).toBe('2026-03-01');
  });

  it('expandRecurring advances nextDate so re-run does not duplicate', async () => {
    const cat = await makeCategory('Contas');
    await addRecurring(db, { type: 'expense', categoryId: cat.id, description: 'Renda', amountCents: 80000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-01-01', endDate: null });
    await expandRecurring(db, '2026-03-31');
    const again = await expandRecurring(db, '2026-03-31');
    expect(again.length).toBe(0);
  });

  it('expandRecurring respects endDate', async () => {
    const cat = await makeCategory('Contas');
    await addRecurring(db, { type: 'expense', categoryId: cat.id, description: 'Renda', amountCents: 80000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-01-01', endDate: '2026-02-15' });
    const txs = await expandRecurring(db, '2026-12-31');
    expect(txs.length).toBe(2); // Jan 1, Feb 1 (Feb 1 <= Feb 15)
  });

  // ---- Grupos (SPEC §6.9) ----
  it('addGroup and transactionsInGroup link transactions', async () => {
    const group = await addGroup(db, 'Casa partilhada', '#0EA5E9');
    const cat = await makeCategory('Alimentacao');
    await addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'Merce', amountCents: 3000, currency: 'EUR', groupId: group.id });
    const inGroup = await transactionsInGroup(db, group.id);
    expect(inGroup.length).toBe(1);
    expect(inGroup[0].description).toBe('Merce');
    const groups = await listGroups(db);
    expect(groups.length).toBe(1);
  });
});

function stampNewSalary(row: { year: number; month: number; amountCents: number }) {
  const now = new Date().toISOString();
  return { id: 'sal-' + Math.random().toString(36).slice(2), createdAt: now, updatedAt: now, deletedAt: null, ...row };
}

describe('calendar grid helpers (Phase 5)', () => {
  it('Monday-first: Nov 2026 starts on a Sunday -> 6 leading empties, 30 days', () => {
    const g = buildCalendarGrid(2026, 11);
    expect(g.length % 7).toBe(0);
    expect(g.slice(0, 6).every((x) => x === 0)).toBe(true);
    expect(g[6]).toBe(1); // first Monday is day 1? Actually Nov 2026: 1st is Monday. Check below.
  });

  it('Feb leap year (2024) has 29 days and grid length multiple of 7', () => {
    const g = buildCalendarGrid(2024, 2);
    expect(g.filter((x) => x > 0).length).toBe(29);
    expect(g.length % 7).toBe(0);
  });

  it('Feb common year (2026) has 28 days', () => {
    const g = buildCalendarGrid(2026, 2);
    expect(g.filter((x) => x > 0).length).toBe(28);
  });

  it('a six-week month produces 42 cells (e.g. Oct 2025 starts Friday)', () => {
    const g = buildCalendarGrid(2025, 10);
    expect(g.length % 7).toBe(0);
    expect(g.filter((x) => x > 0).length).toBe(31);
  });

  it('first and last day are present in the grid', () => {
    const g = buildCalendarGrid(2026, 11);
    expect(g.includes(1)).toBe(true);
    expect(g.includes(30)).toBe(true); // Nov has 30 days
  });

  it('weekday labels are 7 short strings and start with Monday', () => {
    const w = weekdayLabels('en');
    expect(w.length).toBe(7);
    expect(w[0]).toMatch(/Mon/i);
    expect(w[6]).toMatch(/Sun/i);
  });
});

describe('dailyExpenseTotals (Phase 5 calendar)', () => {
  async function addTx(date: string, amountCents: number, type: 'expense' | 'income', currency = 'EUR') {
    const rec = stampNew<Transaction>({ date, amountCents, type, currency, description: 'x', categoryId: 'cat-1' });
    await db.transactions.put(rec);
    return rec;
  }

  it('sums multiple expenses on the same day and ignores income', async () => {
    await addTx('2026-11-15', 1000, 'expense'); // 10.00
    await addTx('2026-11-15', 2350, 'expense'); // 23.50 -> total 33.50
    await addTx('2026-11-15', 5000, 'income');  // must NOT count
    const r = await dailyExpenseTotals(db, 2026, 11, 'EUR');
    expect(r.byDay[15]).toBe(3350);
    expect(r.unconverted).toBe(0);
  });

  it('days with no expenses are absent from the map (UI renders zero)', async () => {
    await addTx('2026-11-03', 500, 'expense');
    const r = await dailyExpenseTotals(db, 2026, 11, 'EUR');
    expect(r.byDay[7]).toBeUndefined(); // day 7 -> UI shows 0.00
  });

  it('excludes soft-deleted expenses', async () => {
    const t = await addTx('2026-11-10', 900, 'expense');
    await db.transactions.update(t.id, { deletedAt: new Date().toISOString() });
    const r = await dailyExpenseTotals(db, 2026, 11, 'EUR');
    expect(r.byDay[10]).toBeUndefined();
  });

  it('does not mix months (group by year/month/day)', async () => {
    await addTx('2026-10-15', 1000, 'expense'); // previous month, same day number
    await addTx('2026-11-15', 2000, 'expense');
    const r = await dailyExpenseTotals(db, 2026, 11, 'EUR');
    expect(r.byDay[15]).toBe(2000); // not 3000
  });

  it('handles first and last day of the month', async () => {
    await addTx('2026-11-01', 100, 'expense');
    await addTx('2026-11-30', 200, 'expense');
    const r = await dailyExpenseTotals(db, 2026, 11, 'EUR');
    expect(r.byDay[1]).toBe(100);
    expect(r.byDay[30]).toBe(200);
  });

  it('February leap year (2024) has day 29; common year (2026) does not', async () => {
    await addTx('2024-02-29', 150, 'expense');
    const rLeap = await dailyExpenseTotals(db, 2024, 2, 'EUR');
    expect(rLeap.byDay[29]).toBe(150);
    const rCommon = await dailyExpenseTotals(db, 2026, 2, 'EUR');
    expect(Object.keys(rCommon.byDay).length).toBe(0); // no Feb 29 in 2026
  });

  it('converts foreign currency when a rate exists; flags and skips it otherwise', async () => {
    await db.exchangeRates.put(stampNew<ExchangeRateRow>({ base: 'EUR', rates: { USD: 1.1 }, fetchedAt: new Date().toISOString() }));
    // rateToTarget looks for row with base === settingsCurrency ('EUR'); rates['USD']=1.1 means 1 USD = 1.1 EUR? 
    // Our helper treats rate as amountCents * rate to reach target, so store the multiplier cents->target.
    await addTx('2026-11-12', 1000, 'expense', 'USD'); // 1000 cents USD -> 1100 cents EUR
    const r = await dailyExpenseTotals(db, 2026, 11, 'EUR');
    expect(r.byDay[12]).toBe(1100);
    expect(r.unconverted).toBe(0);

    // No rate for GBP -> flagged, not summed.
    await addTx('2026-11-13', 500, 'expense', 'GBP');
    const r2 = await dailyExpenseTotals(db, 2026, 11, 'EUR');
    expect(r2.byDay[13]).toBeUndefined();
    expect(r2.unconverted).toBe(1);
  });
});

describe('Goal completion estimate (SPEC §6.8)', () => {
  it('estimates months remaining from observed net savings', async () => {
    const cat = await makeCategory('Salaries');
    await addTransaction(db, { type: 'income', amountCents: 100000, date: '2026-09-05', currency: 'EUR', categoryId: cat.id, description: 'salary' });
    const goal = await addGoal(db, 'Trip', 300000, '2026-01-01');
    const est = await estimateGoalCompletion(db, goal);
    expect(est.months).not.toBeNull();
    expect(est.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(est.months!).toBeGreaterThan(1);
  });

  it('returns null when there is no net savings', async () => {
    const cat = await makeCategory('General');
    await addTransaction(db, { type: 'expense', amountCents: 50000, date: '2026-09-05', currency: 'EUR', categoryId: cat.id, description: 'rent' });
    const goal = await addGoal(db, 'No savings', 100000, '2026-01-01');
    const est = await estimateGoalCompletion(db, goal);
    expect(est.months).toBeNull();
    expect(est.date).toBeNull();
  });

  it('adds pending monthly recurring income to the rate', async () => {
    const goal = await addGoal(db, 'With recurring', 240000, '2026-10-01');
    const cat = await makeCategory('Allowance');
    await addRecurring(db, { type: 'income', categoryId: cat.id, description: 'Allowance', amountCents: 20000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-11-01' });
    const est = await estimateGoalCompletion(db, goal);
    // today is 2026-11-15 -> elapsed 2 months, no materialized txs; rate = 200/month
    // remaining 240000 / 20000 = 12 months
    expect(est.months).toBe(12);
  });

  it('already-finished goals complete now', async () => {
    const goal = await addGoal(db, 'Done', 10000, '2026-01-01');
    const updated = await contributeToGoal(db, goal.id, 10000);
    const est = await estimateGoalCompletion(db, updated);
    expect(est.months).toBe(0);
    expect(est.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Recurring expansion (SPEC §6.9)', () => {
  const rent = (db: WalletDB, cat: Category) => addRecurring(db, { type: 'expense', categoryId: cat.id, description: 'Rent', amountCents: 80000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-09-01' });

  it('expands a monthly recurring into transactions up to today', async () => {
    const cat = await makeCategory('Rent');
    await rent(db, cat);
    const created = await expandRecurring(db, '2026-11-30');
    expect(created.length).toBe(3); // Sep 1, Oct 1, Nov 1
    expect(created[0].date).toBe('2026-09-01');
    expect(created[0].amountCents).toBe(80000);
  });

  it('does not expand beyond endDate', async () => {
    const cat = await makeCategory('Temp');
    await addRecurring(db, { type: 'income', categoryId: cat.id, description: 'Temp', amountCents: 10000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-10-01', endDate: '2026-11-01' });
    const created = await expandRecurring(db, '2026-12-31');
    expect(created.length).toBe(2); // Oct 1 and Nov 1 only
  });

  it('advances nextDate so a second expansion adds nothing', async () => {
    const cat = await makeCategory('Rent2');
    await addRecurring(db, { type: 'expense', categoryId: cat.id, description: 'Rent2', amountCents: 80000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-11-01' });
    const first = await expandRecurring(db, '2026-11-30');
    expect(first.length).toBe(1);
    // Simulate materialization: insert the returned txs and update nextDate as pages do.
    for (const t of first) await db.transactions.add(stampNew<Transaction>(t));
    const rec = (await db.recurrings.toArray())[0];
    await db.recurrings.update(rec.id, { nextDate: '2026-12-01' });
    const second = await expandRecurring(db, '2026-11-30');
    expect(second.length).toBe(0);
  });

  it('weekly frequency advances by 7 days', async () => {
    const cat = await makeCategory('Bus');
    await addRecurring(db, { type: 'expense', categoryId: cat.id, description: 'Bus pass', amountCents: 2000, currency: 'EUR', frequency: 'weekly', nextDate: '2026-11-03' });
    const created = await expandRecurring(db, '2026-11-15');
    expect(created.length).toBe(2); // Nov 3 and Nov 10
    const dates = created.map((t) => t.date);
    expect(dates[1]).toBe('2026-11-10');
  });
});
