import { endOfMonth } from 'date-fns';
import type { WalletDB, Transaction, Category, Budget, Goal, Recurring, Group } from '../db/database';
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

// SPEC §6.6: salary for a period = sum of monthly salaries, prorated by days of each
// month that fall inside the period (for 30/60/90-day windows). Extras count by date.
export async function salaryInRange(db: WalletDB, startDate: string, endDate: string): Promise<number> {
  const salaries = (await db.salaries.toArray()).filter((s) => s.deletedAt === null);
  let total = 0;
  for (const s of salaries) {
    const mStart = `${s.year}-${String(s.month).padStart(2, '0')}-01`;
    const mEnd = endOfMonth(new Date(Date.UTC(s.year, s.month - 1, 1))).toISOString().slice(0, 10);
    // overlap days between [mStart,mEnd] and [startDate,endDate]
    const a = Math.max(new Date(mStart).getTime(), new Date(startDate).getTime());
    const b = Math.min(new Date(mEnd).getTime(), new Date(endDate).getTime());
    if (b < a) continue;
    const overlapDays = Math.floor((b - a) / 86400000) + 1;
    const monthDays = Math.floor((new Date(mEnd).getTime() - new Date(mStart).getTime()) / 86400000) + 1;
    total += Math.round(s.amountCents * (overlapDays / monthDays));
  }
  return total;
}

export interface PeriodSummary {
  period: string; // 'month' | 'year' | '30d' | '60d' | '90d'
  totalSpentCents: number;
  avgPerDayCents: number;
  expenseCount: number;
  maxExpenseCents: number;
  topCategory: { categoryId: string; name: string; totalCents: number } | null;
  salaryCents: number;
  incomeCents: number; // salary + extras (income txs)
  savingsCents: number;
  pctSpent: number; // gasto / rendimento
  pctSavings: number; // poupança / rendimento
  avgMonthlySavingsCents: number;
  missingSalaryMonths: number[]; // months in period with days but salary = 0
}

export async function rangeTransactions(db: WalletDB, startDate: string, endDate: string): Promise<Transaction[]> {
  return db.transactions.filter((t) => t.deletedAt === null && t.date >= startDate && t.date <= endDate).toArray();
}

// SPEC §6.6 full panel indicators for a date range.
export async function periodSummary(db: WalletDB, startDate: string, endDate: string): Promise<PeriodSummary> {
  const txs = await rangeTransactions(db, startDate, endDate);
  const expenses = txs.filter((t) => t.type === 'expense' && t.amountCents > 0);
  const totalSpentCents = expenses.reduce((s, t) => s + t.amountCents, 0);
  const expenseCount = expenses.length;
  const maxExpenseCents = expenses.reduce((m, t) => Math.max(m, t.amountCents), 0);

  // top category by total spend
  const catTotals = new Map<string, number>();
  for (const t of expenses) catTotals.set(t.categoryId, (catTotals.get(t.categoryId) || 0) + t.amountCents);
  let topCategory: PeriodSummary['topCategory'] = null;
  for (const [categoryId, totalCents] of catTotals) {
    if (!topCategory || totalCents > topCategory.totalCents) {
      const c = await db.categories.get(categoryId);
      topCategory = { categoryId, name: c ? c.name : '', totalCents };
    }
  }

  // days in period (inclusive)
  const days = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
  const avgPerDayCents = days > 0 ? Math.round(totalSpentCents / days) : 0;

  // salary: sum of salaries for months overlapping the period, prorated by days inside
  let salaryCents = await salaryInRange(db, startDate, endDate);

  // extras = income transactions (besides salary rows) counted by date
  const extraIncomeCents = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0);
  const incomeCents = salaryCents + extraIncomeCents;
  const savingsCents = incomeCents - totalSpentCents;
  const pctSpent = incomeCents > 0 ? totalSpentCents / incomeCents : 0;
  const pctSavings = incomeCents > 0 ? savingsCents / incomeCents : 0;
  const avgMonthlySavingsCents = days > 0 ? Math.round((savingsCents / days) * 30.44) : 0;

  // missing salary months: months with >=1 day in the period but no salary row for that month
  const missingSalaryMonths: number[] = [];
  const startD = new Date(startDate);
  const endD = new Date(endDate);
  for (let y = startD.getFullYear(); y <= endD.getFullYear(); y++) {
    for (let m = 1; m <= 12; m++) {
      const mStart = `${y}-${String(m).padStart(2, '0')}-01`;
      const mEnd = endOfMonth(new Date(Date.UTC(y, m - 1, 1))).toISOString().slice(0, 10);
      if (mEnd < startDate || mStart > endDate) continue; // month not in period
      const hasSalary = (await db.salaries.where('year').equals(y).filter((s) => s.month === m && s.deletedAt === null && s.amountCents > 0).count()) > 0;
      if (!hasSalary) missingSalaryMonths.push(m);
    }
  }

  return { period: '', totalSpentCents, avgPerDayCents, expenseCount, maxExpenseCents, topCategory, salaryCents, incomeCents, savingsCents, pctSpent, pctSavings, avgMonthlySavingsCents, missingSalaryMonths };
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

// SPEC §6.5 Calendar: total expense per day of a year (YYYY-MM-DD -> cents).
export async function dailyTotals(db: WalletDB, year: number): Promise<Record<string, number>> {
  const txs = await db.transactions.filter((t) => t.deletedAt === null && t.type === 'expense' && t.date.startsWith(String(year))).toArray();
  const map: Record<string, number> = {};
  for (const t of txs) map[t.date] = (map[t.date] || 0) + t.amountCents;
  return map;
}

// SPEC §6.5 Calendar: transactions (expenses+income) on a specific day.
export async function transactionsOnDay(db: WalletDB, date: string): Promise<Transaction[]> {
  return db.transactions.filter((t) => t.deletedAt === null && t.date === date).toArray();
}

// SPEC §6.4 Salaries: editable year x month grid (12 months) plus dated extras.
export async function salaryGrid(db: WalletDB, year: number): Promise<Array<{ month: number; amountCents: number }>> {
  const salaries = (await db.salaries.toArray()).filter((s) => s.deletedAt === null && s.year === year);
  const grid: Array<{ month: number; amountCents: number }> = [];
  for (let m = 1; m <= 12; m++) {
    const found = salaries.filter((s) => s.month === m).reduce((sum, s) => sum + s.amountCents, 0);
    grid.push({ month: m, amountCents: found });
  }
  return grid;
}

// SPEC §6.4 Salaries: per-year totals (salaries, expenses, savings, % savings).
export async function salaryYearSummary(db: WalletDB, year: number): Promise<{ salaryCents: number; expenseCents: number; savingsCents: number; pctSavings: number }> {
  const grid = await salaryGrid(db, year);
  const salaryCents = grid.reduce((s, g) => s + g.amountCents, 0);
  const txs = await db.transactions.filter((t) => t.deletedAt === null && t.date.startsWith(String(year))).toArray();
  const expenseCents = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountCents, 0);
  const savingsCents = salaryCents - expenseCents;
  return { salaryCents, expenseCents, savingsCents, pctSavings: salaryCents > 0 ? savingsCents / salaryCents : 0 };
}

export async function setSalary(db: WalletDB, year: number, month: number, amountCents: number): Promise<void> {
  assertCents(amountCents);
  const salaries = (await db.salaries.toArray()).filter((s) => s.deletedAt === null && s.year === year && s.month === month);
  if (salaries.length > 0) {
    await db.salaries.update(salaries[0].id, { amountCents, updatedAt: new Date().toISOString() });
  } else {
    const now = new Date().toISOString();
    await db.salaries.add({ id: crypto.randomUUID(), year, month, amountCents, createdAt: now, updatedAt: now, deletedAt: null });
  }
}

// ---- Metas (SPEC §6.7) ----
export async function addGoal(db: WalletDB, name: string, targetCents: number, startDate: string, targetDate?: string | null): Promise<Goal> {
  assertCents(targetCents);
  if (targetCents <= 0) throw new Error('Meta precisa de um alvo maior que zero');
  const row = stampNew({ name, targetCents, currentCents: 0, startDate, targetDate: targetDate ?? null });
  await db.goals.add(row);
  return row;
}

export async function contributeToGoal(db: WalletDB, goalId: string, amountCents: number): Promise<Goal> {
  assertCents(amountCents);
  if (amountCents <= 0) throw new Error('Contribuicao deve ser maior que zero');
  const goal = await db.goals.get(goalId);
  if (!goal || goal.deletedAt) throw new Error('Meta nao encontrada');
  const current = goal.currentCents + amountCents;
  await db.goals.update(goalId, { currentCents: current, updatedAt: new Date().toISOString() });
  return (await db.goals.get(goalId))!;
}

export async function listGoals(db: WalletDB): Promise<Goal[]> {
  return (await db.goals.toArray()).filter((g) => g.deletedAt === null);
}

// ---- Recorrentes (SPEC §6.9) ----
// Timezone-safe: 'YYYY-MM-DD' is treated as a plain calendar date (no UTC shift).
function addMonths(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const day = Math.min(d, daysInMonth);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function addRecurring(db: WalletDB, input: Omit<Recurring, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Recurring> {
  assertCents(input.amountCents);
  if (input.amountCents <= 0) throw new Error('Valor recorrente deve ser maior que zero');
  return db.recurrings.add(stampNew(input));
}

// Generate transactions for recurring entries up to `untilDate` (YYYY-MM-DD).
// Returns the list of transactions that should be inserted.
export async function expandRecurring(db: WalletDB, untilDate: string): Promise<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[]> {
  const recs = (await db.recurrings.toArray()).filter((r) => r.deletedAt === null);
  const out: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[] = [];
  for (const r of recs) {
    let date = r.nextDate;
    const end = r.endDate ?? untilDate;
    while (date <= end) {
      out.push({ date, type: r.type, categoryId: r.categoryId, description: r.description, amountCents: r.amountCents, currency: r.currency, recurringId: r.id });
      if (r.frequency === 'weekly') {
        const d = new Date(date); d.setDate(d.getDate() + 7); date = d.toISOString().slice(0, 10);
      } else if (r.frequency === 'yearly') {
        date = addMonths(date, 12);
      } else {
        date = addMonths(date, 1);
      }
    }
    // Advance nextDate past untilDate so re-running doesn't duplicate.
    await db.recurrings.update(r.id, { nextDate: date, updatedAt: new Date().toISOString() });
  }
  return out;
}

export async function listRecurring(db: WalletDB): Promise<Recurring[]> {
  return (await db.recurrings.toArray()).filter((r) => r.deletedAt === null);
}

// ---- Grupos (SPEC §6.9) ----
export async function addGroup(db: WalletDB, name: string, color: string): Promise<Group> {
  return db.groups.add(stampNew({ name, color }));
}

export async function listGroups(db: WalletDB): Promise<Group[]> {
  return (await db.groups.toArray()).filter((g) => g.deletedAt === null);
}

// Transactions belonging to a group.
export async function transactionsInGroup(db: WalletDB, groupId: string): Promise<Transaction[]> {
  return (await db.transactions.toArray()).filter((t) => t.deletedAt === null && t.groupId === groupId);
}
