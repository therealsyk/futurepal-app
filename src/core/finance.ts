import { endOfMonth } from 'date-fns';
import type { WalletDB, Transaction, Category, Budget } from '../db/database';
import { stampNew } from '../db/database';
import { assertCents } from './money';

export const MAX_ACTIVE_CATEGORIES = 12;

const VALID_TYPES = new Set(['expense', 'income']);

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  // Real calendar day: JS Date normalizes 2026-02-31 to 2026-03-03.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

export async function addTransaction(db: WalletDB, input: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Transaction> {
  assertCents(input.amountCents);
  if (input.amountCents <= 0) throw new Error('amountCents must be > 0');
  if (!VALID_TYPES.has(input.type)) throw new Error(`invalid type: ${input.type}`);
  if (!isValidDate(input.date)) throw new Error(`invalid date: ${input.date}`);
  if (!isValidCurrency(input.currency)) throw new Error(`invalid currency: ${input.currency}`);
  const cat = await db.categories.get(input.categoryId);
  if (!cat || cat.deletedAt !== null) throw new Error(`category not found: ${input.categoryId}`);
  const tx = stampNew<Transaction>(input);
  await db.transactions.add(tx);
  return tx;
}

// Soft delete: mark deletedAt, never remove the row (SPEC §2/§6.2).
export async function softDelete(db: WalletDB, table: 'transactions' | 'categories' | 'budgets' | 'salaries', id: string): Promise<void> {
  const t = db.table(table) as any;
  await t.update(id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function activeCategories(db: WalletDB): Promise<Category[]> {
  const all = await db.categories.toArray();
  return all.filter((c) => c.deletedAt === null).sort((a, b) => a.order - b.order);
}

// SPEC §6.1/§6.3: default categories (nameKey + color). Seeded when the DB has none,
// so Transações works even if the Setup Wizard was skipped. Pure/testable.
export const DEFAULT_CATEGORY_DEFS = [
  { nameKey: 'catSalary', color: '#4CAF50' },
  { nameKey: 'catFood', color: '#FFB020' },
  { nameKey: 'catTransport', color: '#3B82F6' },
  { nameKey: 'catRent', color: '#8B5CF6' },
  { nameKey: 'catHealth', color: '#EF4444' },
  { nameKey: 'catAnimals', color: '#10B981' },
  { nameKey: 'catShopping', color: '#F59E0B' },
  { nameKey: 'catLeisure', color: '#6366F1' },
  { nameKey: 'catOther', color: '#9CA3AF' },
  { nameKey: 'catCar', color: '#0EA5E9' },
  { nameKey: 'catClothes', color: '#EC4899' },
];

export async function ensureDefaultCategories(db: WalletDB): Promise<void> {
  const existing = await activeCategories(db);
  if (existing.length > 0) return;
  for (let i = 0; i < DEFAULT_CATEGORY_DEFS.length; i++) {
    const def = DEFAULT_CATEGORY_DEFS[i];
    await addCategory(db, { name: def.nameKey, color: def.color, icon: '', order: i, nameKey: def.nameKey });
  }
}

export async function addCategory(db: WalletDB, input: Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Category> {
  const active = await activeCategories(db);
  if (active.length >= MAX_ACTIVE_CATEGORIES) throw new Error(`max ${MAX_ACTIVE_CATEGORIES} active categories`);
  const cat = stampNew<Category>(input);
  await db.categories.add(cat);
  return cat;
}

export async function monthTransactions(db: WalletDB, year: number, month: number): Promise<Transaction[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = endOfMonth(new Date(Date.UTC(year, month - 1, 1))).toISOString().slice(0, 10); // real last day
  return db.transactions.filter((t) => t.deletedAt === null && t.date >= start && t.date <= end).toArray();
}

// All queries ignore soft-deleted rows.
export async function totalsByCategory(db: WalletDB, year: number, month: number): Promise<Array<{ categoryId: string; name: string; type: 'expense' | 'income'; totalCents: number }>> {
  const txs = (await monthTransactions(db, year, month)).filter((t) => t.deletedAt === null);
  const cats = await db.categories.toArray();
  const catMap = new Map<string, { categoryId: string; name: string; type: 'expense' | 'income'; totalCents: number }>();
  for (const c of cats) {
    if (c.deletedAt !== null) continue;
    catMap.set(c.id, { categoryId: c.id, name: c.name, type: 'expense', totalCents: 0 });
  }
  for (const t of txs) {
    const entry = catMap.get(t.categoryId);
    if (entry) entry.totalCents += t.amountCents;
  }
  return [...catMap.values()];
}

export interface TxFilter {
  year?: number;
  month?: number;
  categoryId?: string;
  text?: string;
}

// SPEC §6.2: filters by month, category and free text. Ignores soft-deleted rows.
export async function filterTransactions(db: WalletDB, filter: TxFilter): Promise<Transaction[]> {
  let txs = await db.transactions.filter((t) => t.deletedAt === null).toArray();
  if (filter.year && filter.month) {
    const start = `${filter.year}-${String(filter.month).padStart(2, '0')}-01`;
    const end = endOfMonth(new Date(Date.UTC(filter.year, filter.month - 1, 1))).toISOString().slice(0, 10);
    txs = txs.filter((t) => t.date >= start && t.date <= end);
  }
  if (filter.categoryId) txs = txs.filter((t) => t.categoryId === filter.categoryId);
  if (filter.text) {
    const q = filter.text.trim().toLowerCase();
    if (q) txs = txs.filter((t) => (t.description || '').toLowerCase().includes(q));
  }
  txs.sort((a, b) => (a.date < b.date ? 1 : -1));
  return txs;
}

export async function monthSummary(db: WalletDB, year: number, month: number): Promise<{ incomeCents: number; expenseCents: number; netCents: number }> {
  const txs = (await monthTransactions(db, year, month)).filter((t) => t.deletedAt === null);
  let incomeCents = 0;
  let expenseCents = 0;
  for (const t of txs) {
    if (t.type === 'income') incomeCents += t.amountCents;
    else expenseCents += t.amountCents;
  }
  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents };
}

// Budgets use period 'month' (SPEC §5). A budget applies to the given year/month.
export async function setBudget(db: WalletDB, categoryId: string, limitCents: number, year: number, month: number): Promise<void> {
  assertCents(limitCents);
  const existing = await db.budgets.where('categoryId').equals(categoryId).toArray();
  const match = existing.find((b) => b.deletedAt === null && b.year === year && b.month === month);
  if (match) {
    await db.budgets.update(match.id, { limitCents, updatedAt: new Date().toISOString() });
  } else {
    await db.budgets.add(stampNew<Budget>({ categoryId, limitCents, period: 'month', year, month }));
  }
}

export async function budgetUsage(db: WalletDB, categoryId: string, year: number, month: number): Promise<{ limitCents: number; spentCents: number; remainingCents: number; overBudget: boolean }> {
  const budgets = await db.budgets.where('categoryId').equals(categoryId).toArray();
  let limitCents = 0;
  for (const b of budgets) {
    if (b.deletedAt !== null) continue;
    if (b.year === year && b.month === month) limitCents = b.limitCents;
  }
  const txs = (await monthTransactions(db, year, month)).filter((t) => t.deletedAt === null && t.categoryId === categoryId && t.type === 'expense');
  const spentCents = txs.reduce((s, t) => s + t.amountCents, 0);
  return { limitCents, spentCents, remainingCents: limitCents - spentCents, overBudget: spentCents > limitCents };
}
