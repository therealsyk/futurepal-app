import type { WalletDB, Transaction } from '../db/database';

export interface CategoryTotals {
  categoryId: number;
  name: string;
  isIncome: boolean;
  total: number; // sum of amounts (expenses negative)
}

// Pure helpers that operate on a Dexie DB. All logic here, so tests can drive it.

export async function addTransaction(db: WalletDB, tx: Omit<Transaction, 'id'>): Promise<number> {
  if (!Number.isFinite(tx.amount) || tx.amount === 0) {
    throw new Error('amount must be a non-zero number');
  }
  if (!tx.date || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  return db.transactions.add(tx);
}

export async function monthTransactions(db: WalletDB, year: number, month: number): Promise<Transaction[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;
  return db.transactions.where('date').between(start, end).toArray();
}

export async function totalsByCategory(db: WalletDB, year: number, month: number): Promise<CategoryTotals[]> {
  const txs = await monthTransactions(db, year, month);
  const cats = await db.categories.toArray();
  const catMap = new Map<number, CategoryTotals>();
  for (const c of cats) {
    catMap.set(c.id!, { categoryId: c.id!, name: c.name, isIncome: c.isIncome, total: 0 });
  }
  for (const t of txs) {
    const entry = catMap.get(t.categoryId);
    if (entry) entry.total += t.amount;
  }
  return [...catMap.values()];
}

export async function monthSummary(db: WalletDB, year: number, month: number) {
  const txs = await monthTransactions(db, year, month);
  let income = 0;
  let expenses = 0;
  for (const t of txs) {
    if (t.amount > 0) income += t.amount;
    else expenses += -t.amount;
  }
  return { income, expenses, net: income - expenses };
}

// Budget vs actual: returns the limit and how much was spent (expenses only) for a category.
export async function budgetUsage(db: WalletDB, categoryId: number, year: number, month: number) {
  const budgets = await db.budgets.where('categoryId').equals(categoryId).toArray();
  // Prefer a month/year-specific override if present, else the global limit.
  let limit = 0;
  for (const b of budgets) {
    if (b.month === month && b.year === year) {
      limit = b.limit;
    } else if (b.month == null && b.year == null) {
      limit = b.limit;
    }
  }
  const txs = await monthTransactions(db, year, month);
  let spent = 0;
  for (const t of txs) {
    if (t.categoryId === categoryId && t.amount < 0) spent += -t.amount;
  }
  return { limit, spent, remaining: limit - spent, overBudget: spent > limit };
}

export async function setBudget(db: WalletDB, categoryId: number, limit: number, month?: number, year?: number): Promise<void> {
  const existing = await db.budgets.where('categoryId').equals(categoryId).toArray();
  const match = existing.find((b) => b.month === (month ?? null) && b.year === (year ?? null));
  if (match) {
    await db.budgets.update(match.id!, { limit });
  } else {
    await db.budgets.add({ categoryId, limit, month, year });
  }
}
