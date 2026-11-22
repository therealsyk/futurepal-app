import type { Transfer, WalletDB, Transaction, Category, Budget, Goal, Recurring, Group } from '../db/database';
import { stampNew } from '../db/database';
import { assertCents } from './money';
import { CATALOG_ITEMS } from './categoryCatalog';
import { monthEnd, todayISO } from './dates';

export const MAX_ACTIVE_CATEGORIES = 100;

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
export async function softDelete(db: WalletDB, table: 'transactions' | 'categories' | 'budgets' | 'salaries' | 'goals' | 'recurrings' | 'groups', id: string): Promise<void> {
  const t = db.table(table) as any;
  await t.update(id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  if (table === 'transactions') await deleteSalaryOfTx(db, id); // apagar o salário nas Transações apaga-o também nos Salários
}

export async function activeCategories(db: WalletDB): Promise<Category[]> {
  const all = await db.categories.toArray();
  return all.filter((c) => c.deletedAt === null).sort((a, b) => a.order - b.order);
}

// SPEC §6.1/§6.3: default categories (nameKey + color). Seeded when the DB has none,
// so Transações works even if the Setup Wizard was skipped. Pure/testable.
// Categorias padrão = todo o catálogo (grupos e ícones em core/categoryCatalog.ts).
// Têm id FIXO (cat-<chave>): todos os aparelhos da mesma conta criam os mesmos ids, e a sincronização
// junta-as em vez de as duplicar.
export const defaultCategoryId = (nameKey: string) => `cat-${nameKey}`;
export const DEFAULT_CATEGORY_DEFS = CATALOG_ITEMS.map((i) => ({ nameKey: i.key, color: i.color, icon: i.icon, group: i.group }));

// Instalações antigas: acrescenta as categorias do catálogo que ainda não existem (nem foram apagadas pela pessoa)
// e preenche o grupo/ícone das que já existiam. Corre uma vez por aparelho (ver App.tsx).
export async function addMissingCatalogCategories(db: WalletDB): Promise<number> {
  return db.transaction('rw', db.categories, async () => {
    const all = await db.categories.toArray();
    const now = new Date().toISOString();
    let order = all.reduce((m, c) => Math.max(m, c.order ?? 0), 0) + 1;
    let added = 0;
    for (const def of DEFAULT_CATEGORY_DEFS) {
      const existing = all.filter((c) => c.nameKey === def.nameKey);
      for (const c of existing) {
        if (!c.group || !c.icon) await db.categories.put({ ...c, group: c.group || def.group, icon: c.icon || def.icon, updatedAt: now });
      }
      if (existing.length > 0) continue; // existe (ou foi apagada de propósito)
      await db.categories.put({ ...stampNew<Category>({ name: def.nameKey, color: def.color, icon: def.icon, group: def.group, order: order++, nameKey: def.nameKey }), id: defaultCategoryId(def.nameKey) });
      added++;
    }
    return added;
  });
}

// Pode ser chamada de vários sítios ao mesmo tempo (App, setup, StrictMode): a verificação e a
// criação correm dentro de UMA transação, por isso só a primeira chamada cria as categorias.
export async function ensureDefaultCategories(db: WalletDB): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const existing = await db.categories.filter((c) => c.deletedAt === null).count();
    if (existing > 0) return;
    await db.categories.bulkAdd(
      DEFAULT_CATEGORY_DEFS.map((def, i) => ({ ...stampNew<Category>({ name: def.nameKey, color: def.color, icon: def.icon, group: def.group, order: i, nameKey: def.nameKey }), id: defaultCategoryId(def.nameKey) })),
    );
  });
}

export async function addCategory(db: WalletDB, input: Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Category> {
  const active = await activeCategories(db);
  if (active.length >= MAX_ACTIVE_CATEGORIES) throw new Error(`max ${MAX_ACTIVE_CATEGORIES} active categories`);
  // Auto-match a picture from the name when none is supplied.
  const cat = stampNew<Category>({ ...input });
  await db.categories.add(cat);
  return cat;
}

export async function monthTransactions(db: WalletDB, year: number, month: number): Promise<Transaction[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = monthEnd(year, month); // real last day
  return db.transactions.filter((t) => t.deletedAt === null && t.date >= start && t.date <= end).toArray();
}

// ── Dashboard KPI helpers (pure, integer cents) ───────────────────────────────
export interface DaySpend { day: string; cents: number }

// Expenses grouped by calendar day, sorted by day. Used by the daily-spend heatmap.
export function spendByDay(txs: Transaction[]): DaySpend[] {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (t.deletedAt !== null || t.type !== 'expense') continue;
    map.set(t.date, (map.get(t.date) ?? 0) + t.amountCents);
  }
  return [...map.entries()].map(([day, cents]) => ({ day, cents })).sort((a, b) => a.day.localeCompare(b.day));
}

export interface PeriodKpis {
  totalSpentCents: number;
  expenseCount: number;
  largestExpenseCents: number;
  topCategoryName: string | null;
  topCategoryCents: number;
  avgDailyCents: number; // spent / distinct days with expenses (Excel "Média/dia")
}

// Excel "Resumo" strip: totals for a set of transactions. Pure and testable.
export function periodKpis(txs: Transaction[], categories: Category[]): PeriodKpis {
  const expenses = txs.filter((t) => t.deletedAt === null && t.type === 'expense');
  let totalSpentCents = 0;
  let largestExpenseCents = 0;
  const byCat = new Map<string, number>();
  const days = new Set<string>();
  for (const t of expenses) {
    totalSpentCents += t.amountCents;
    if (t.amountCents > largestExpenseCents) largestExpenseCents = t.amountCents;
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amountCents);
    days.add(t.date);
  }
  let topCategoryName: string | null = null;
  let topCategoryCents = 0;
  for (const [id, cents] of byCat) {
    if (cents > topCategoryCents) {
      topCategoryCents = cents;
      const cat = categories.find((c) => c.id === id);
      topCategoryName = cat ? cat.name : null;
    }
  }
  return {
    totalSpentCents,
    expenseCount: expenses.length,
    largestExpenseCents,
    topCategoryName,
    topCategoryCents,
    avgDailyCents: days.size > 0 ? Math.round(totalSpentCents / days.size) : 0,
  };
}

export interface CategoryTotal {
  categoryId: string;
  name: string;
  type: 'expense' | 'income';
  totalCents: number;
}

// All queries ignore soft-deleted rows.
export async function totalsByCategory(db: WalletDB, year: number, month: number): Promise<CategoryTotal[]> {
  const txs = (await monthTransactions(db, year, month)).filter((t) => t.deletedAt === null);
  const cats = await db.categories.toArray();
  const catMap = new Map<string, CategoryTotal>();
  for (const c of cats) {
    if (c.deletedAt !== null) continue;
    catMap.set(c.id, { categoryId: c.id, name: c.name, type: 'expense', totalCents: 0 });
  }
  for (const t of txs) {
    const entry = catMap.get(t.categoryId);
    if (entry) entry.totalCents += t.amountCents;
  }
  return [...catMap.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export interface TxFilter {
  year?: number;
  month?: number;
  categoryId?: string;
  text?: string;
  groupId?: string;
}

// SPEC §6.2: filters by month, category and free text. Ignores soft-deleted rows.
export async function filterTransactions(db: WalletDB, filter: TxFilter): Promise<Transaction[]> {
  let txs = await db.transactions.filter((t) => t.deletedAt === null).toArray();
  if (filter.year && filter.month) {
    const start = `${filter.year}-${String(filter.month).padStart(2, '0')}-01`;
    const end = monthEnd(filter.year, filter.month);
    txs = txs.filter((t) => t.date >= start && t.date <= end);
  } else if (filter.year) {
    const y = String(filter.year) + '-'; // ano inteiro
    txs = txs.filter((t) => t.date.startsWith(y));
  }
  if (filter.categoryId) txs = txs.filter((t) => t.categoryId === filter.categoryId);
  if (filter.groupId) txs = txs.filter((t) => t.groupId === filter.groupId);
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
    const mEnd = monthEnd(s.year, s.month);
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
  const extraIncomeCents = txs.filter((t) => t.type === 'income' && !isSalaryTx(t)).reduce((s, t) => s + t.amountCents, 0);
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
      const mEnd = monthEnd(y, m);
      if (mEnd < startDate || mStart > endDate) continue; // month not in period
      const hasSalary = (await db.salaries.where('year').equals(y).filter((s) => s.month === m && s.deletedAt === null && s.amountCents > 0).count()) > 0;
      if (!hasSalary) missingSalaryMonths.push(m);
    }
  }

  return { period: '', totalSpentCents, avgPerDayCents, expenseCount, maxExpenseCents, topCategory, salaryCents, incomeCents, savingsCents, pctSpent, pctSavings, avgMonthlySavingsCents, missingSalaryMonths };
}

// SPEC §6.6 monthly expense/income totals for the panel bar chart.
export async function monthlyTotals(db: WalletDB, year: number): Promise<{ expense: number; income: number }[]> {
  const result: { expense: number; income: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const start = `${year}-${String(m).padStart(2, '0')}-01`;
    const end = monthEnd(year, m);
    const txs = await rangeTransactions(db, start, end);
    const expense = txs.filter((t) => t.type === 'expense' && t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
    const salary = await salaryInRange(db, start, end);
    const income = salary + txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0);
    result.push({ expense, income });
  }
  return result;
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

// SPEC §6.5 / Phase 5: per-day expense totals for one calendar month, expressed in the
// settings currency. Only active expenses count (income and soft-deleted rows are excluded).
// Foreign-currency expenses are converted using a stored exchange rate when available; if no
// rate exists they are NOT summed (flagged instead) so we never invent a total by mixing currencies.
export interface DailyExpenseResult {
  // day-of-month (1..31) -> cents in settings currency
  byDay: Record<number, number>;
  // number of expense transactions in other currencies that could not be converted
  unconverted: number;
}

export async function dailyExpenseTotals(
  db: WalletDB,
  year: number,
  month: number,
  settingsCurrency: string,
): Promise<DailyExpenseResult> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = monthEnd(year, month); // real last day
  const txs = await db.transactions
    .filter((t) => t.deletedAt === null && t.type === 'expense' && t.date >= start && t.date <= end)
    .toArray();

  // Build a quick base->target rate lookup from stored exchange rates (latest fetched).
  let rateToTarget: Record<string, number> | null = null;
  const hasForeign = txs.some((t) => t.currency !== settingsCurrency);
  if (hasForeign) {
    const rows = await db.exchangeRates.toArray();
    // Prefer a row whose base is the target currency (rates[target] would be 1) or any recent row.
    const targetRow = rows.find((r) => r.base === settingsCurrency);
    if (targetRow) rateToTarget = targetRow.rates;
  }

  const byDay: Record<number, number> = {};
  let unconverted = 0;
  for (const t of txs) {
    let cents = t.amountCents;
    if (t.currency !== settingsCurrency) {
      const rate = rateToTarget?.[t.currency];
      if (!rate || !Number.isFinite(rate)) {
        unconverted++;
        continue; // do not silently mix currencies
      }
      cents = Math.round(t.amountCents * rate);
    }
    const day = parseInt(t.date.slice(8, 10), 10);
    byDay[day] = (byDay[day] || 0) + cents;
  }
  return { byDay, unconverted };
}

// 7-column calendar grid for a month. Returns day numbers (1..31) with 0 for the
// leading/trailing empty cells, length always a multiple of 7.
// firstDayOfWeek: 0 = Sunday .. 6 = Saturday (settings.firstDayOfWeek); default Monday.
export function buildCalendarGrid(year: number, month: number, firstDayOfWeek = 1): number[] {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const leading = (dow - firstDayOfWeek + 7) % 7; // empty cells before the 1st
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getDate();
  const cells: number[] = [];
  for (let i = 0; i < leading; i++) cells.push(0);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(0);
  return cells;
}

// Short weekday labels in the app language, starting at firstDayOfWeek (default Monday).
export function weekdayLabels(language: string, firstDayOfWeek = 1): string[] {
  const start = (firstDayOfWeek + 6) % 7; // offset from Monday
  try {
    const fmt = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' });
    const labels: string[] = [];
    for (let i = 0; i < 7; i++) {
      // 2024-01-01 was a Monday; iterate 7 consecutive days.
      labels.push(fmt.format(new Date(Date.UTC(2024, 0, 1 + start + i))));
    }
    return labels;
  } catch {
    const en = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return [...en.slice(start), ...en.slice(0, start)];
  }
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
    // Um só salário por mês: atualiza o mais recente e apaga repetidos (ex.: criados em 2 aparelhos ou num import),
    // senão os valores somavam-se (500 + 500 = 1000).
    const now = new Date().toISOString();
    const [keep, ...dups] = salaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await db.salaries.update(keep.id, { amountCents, updatedAt: now });
    for (const d of dups) await db.salaries.update(d.id, { deletedAt: now, updatedAt: now });
  } else {
    const now = new Date().toISOString();
    await db.salaries.add({ id: crypto.randomUUID(), year, month, amountCents, createdAt: now, updatedAt: now, deletedAt: null });
  }
}

// ---- Metas (SPEC §6.7) ----
export async function addGoal(db: WalletDB, name: string, targetCents: number, startDate: string, targetDate?: string | null): Promise<Goal> {
  assertCents(targetCents);
  if (targetCents <= 0) throw new Error('Meta precisa de um alvo maior que zero');
  const row = stampNew<Goal>({ name, targetCents, currentCents: 0, startDate, targetDate: targetDate ?? null });
  await db.goals.add(row);
  return row;
}

export async function contributeToGoal(db: WalletDB, goalId: string, amountCents: number): Promise<Goal> {
  assertCents(amountCents);
  if (amountCents <= 0) throw new Error('Contribuicao deve ser maior que zero');
  const goal = await db.goals.get(goalId);
  if (!goal || goal.deletedAt) throw new Error('Meta nao encontrada');
  const current = goal.currentCents + amountCents;
  const now = new Date().toISOString();
  await db.goals.update(goalId, { currentCents: current, contributions: [...(goal.contributions ?? []), { date: now.slice(0, 10), cents: amountCents }], updatedAt: now });
  return (await db.goals.get(goalId))!;
}

export async function listGoals(db: WalletDB): Promise<Goal[]> {
  return (await db.goals.toArray()).filter((g) => g.deletedAt === null);
}

// SPEC §6.8: estimate when a goal will be reached from the observed saving rate.
// Rate = net surplus (income - expenses) since the goal started, averaged per month.
// If recurring incomes exist, they are added on top (they may not have been materialized yet).
export async function estimateGoalCompletion(db: WalletDB, goal: Goal): Promise<{ months: number | null; date: string | null }> {
  if (goal.currentCents >= goal.targetCents) return { months: 0, date: todayISO() };

  const today = todayISO();
  const txs = (await db.transactions.toArray()).filter((t) => t.deletedAt === null && t.date >= goal.startDate && t.date <= today);

  let income = 0;
  let expense = 0;
  for (const tx of txs) {
    if (tx.type === 'income') income += tx.amountCents;
    else expense += tx.amountCents;
  }

  // Months elapsed since the goal started (at least 1 to avoid divide-by-zero).
  const startY = Number(goal.startDate.slice(0, 4));
  const startM = Number(goal.startDate.slice(5, 7));
  const nowY = Number(today.slice(0, 4));
  const nowM = Number(today.slice(5, 7));
  const elapsedMonths = Math.max(1, (nowY - startY) * 12 + (nowM - startM) + 1);

  let monthlyRate = (income - expense) / elapsedMonths;

  // Add recurring incomes that are still pending expansion.
  const recs = (await db.recurrings.toArray()).filter((r) => r.deletedAt === null && r.type === 'income');
  for (const r of recs) {
    monthlyRate += monthlyEquivalentCents(r.amountCents, r.frequency);
  }

  if (monthlyRate <= 0) return { months: null, date: null };

  const remaining = goal.targetCents - goal.currentCents;
  const months = Math.ceil(remaining / monthlyRate);
  return { months, date: addMonths(today, months) };
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


import type { RecurringFrequency } from '../db/database';
import { deleteSalaryOfTx, isSalaryTx } from './salaryTx';

export const RECURRING_FREQUENCIES: RecurringFrequency[] = ['daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly'];

// Quantos meses/dias cada frequência avança.
const FREQ_STEP: Record<RecurringFrequency, { months?: number; days?: number }> = {
  daily: { days: 1 }, weekly: { days: 7 }, biweekly: { days: 14 },
  monthly: { months: 1 }, bimonthly: { months: 2 }, quarterly: { months: 3 }, semiannual: { months: 6 }, yearly: { months: 12 },
};

function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Próxima ocorrência depois de `date`. `anchorDay` (dia original) evita que 31 → 28 → 28 em meses curtos.
export function advanceDate(date: string, freq: RecurringFrequency, anchorDay?: number): string {
  const step = FREQ_STEP[freq] ?? FREQ_STEP.monthly;
  if (step.days) return addDays(date, step.days);
  const next = addMonths(date, step.months ?? 1);
  if (anchorDay && anchorDay > Number(date.slice(8, 10))) {
    const [y, m] = next.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${next.slice(0, 8)}${String(Math.min(anchorDay, dim)).padStart(2, '0')}`;
  }
  return next;
}

// Valor aproximado por mês (para estimativas).
export function monthlyEquivalentCents(amountCents: number, freq: RecurringFrequency): number {
  const perYear: Record<RecurringFrequency, number> = { daily: 365, weekly: 52, biweekly: 26, monthly: 12, bimonthly: 6, quarterly: 4, semiannual: 2, yearly: 1 };
  return Math.round((amountCents * (perYear[freq] ?? 12)) / 12);
}

export async function addRecurring(db: WalletDB, input: Omit<Recurring, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<Recurring> {
  assertCents(input.amountCents);
  if (input.amountCents <= 0) throw new Error('Valor recorrente deve ser maior que zero');
  return db.recurrings.add(stampNew<Recurring>(input));
}

// Generate transactions for recurring entries up to `untilDate` (YYYY-MM-DD).
// Returns the list of transactions that should be inserted.
type RecurringOut = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { toAccountId?: string };
export async function expandRecurring(db: WalletDB, untilDate: string): Promise<RecurringOut[]> {
  const recs = (await db.recurrings.toArray()).filter((r) => r.deletedAt === null);
  const out: RecurringOut[] = [];
  for (const r of recs) {
    let date = r.nextDate;
    const anchor = Number(r.nextDate.slice(8, 10));
    const end = r.endDate && r.endDate < untilDate ? r.endDate : untilDate;
    while (date <= end) {
      out.push({ date, type: r.type, categoryId: r.categoryId, description: r.description, amountCents: r.amountCents, currency: r.currency, recurringId: r.id, accountId: r.accountId, ...(r.toAccountId ? { toAccountId: r.toAccountId } : {}) });
      date = advanceDate(date, r.frequency, anchor);
    }
    // Advance nextDate past untilDate so re-running doesn't duplicate.
    await db.recurrings.update(r.id, { nextDate: date, updatedAt: new Date().toISOString() });
  }
  return out;
}

// Cria as despesas/rendimentos recorrentes que já venceram (data <= hoje) e avança a próxima data.
// Seguro para chamar várias vezes: cada ocorrência só é criada uma vez. Devolve quantas criou.
export async function materializeDueRecurrings(db: WalletDB, today: string): Promise<number> {
  const items = await expandRecurring(db, today);
  for (const it of items) {
    if (it.toAccountId && it.accountId) { // transferência recorrente
      await db.transfers.add(stampNew<Transfer>({ fromAccountId: it.accountId, toAccountId: it.toAccountId, amountCents: it.amountCents, date: it.date, note: it.description, categoryId: null, transactionId: null }));
      continue;
    }
    const { toAccountId: _skip, ...tx } = it; // eslint-disable-line @typescript-eslint/no-unused-vars
    await db.transactions.add(stampNew<Transaction>(tx));
  }
  return items.length;
}

export async function listRecurring(db: WalletDB): Promise<Recurring[]> {
  return (await db.recurrings.toArray()).filter((r) => r.deletedAt === null);
}

// ---- Grupos (SPEC §6.9) ----
export async function addGroup(db: WalletDB, name: string, color: string): Promise<Group> {
  const g = stampNew<Group>({ name, color });
  await db.groups.add(g); // add() devolve só o id
  return g;
}

export async function listGroups(db: WalletDB): Promise<Group[]> {
  return (await db.groups.toArray()).filter((g) => g.deletedAt === null);
}

// Transactions belonging to a group.
export async function transactionsInGroup(db: WalletDB, groupId: string): Promise<Transaction[]> {
  return (await db.transactions.toArray()).filter((t) => t.deletedAt === null && t.groupId === groupId);
}
