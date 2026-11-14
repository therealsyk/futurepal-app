import Dexie, { type Table } from 'dexie';

// Base fields every record carries (SPEC §2: sync-ready soft deletes).
export interface BaseRecord {
  id: string; // UUID
  createdAt: string; // ISO
  updatedAt: string; // ISO
  deletedAt: string | null; // null = active
}


function nowISO(): string {
  return new Date().toISOString();
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for runtimes without crypto.randomUUID (tests).
  return 'id-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}

// Build a record with UUID + timestamps. The caller supplies the payload fields.
export function stampNew<T extends BaseRecord>(record: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): T {
  return { ...record, id: newId(), createdAt: nowISO(), updatedAt: nowISO(), deletedAt: null } as T;
}

// SPEC §5 tables.
export interface SettingsRow extends BaseRecord {
  language: string;
  country: string;
  mainCurrency: string;
  firstDayOfWeek: number; // 0-6 (0 = Sunday)
  dateFormat: 'DMY' | 'MDY' | 'YMD';
  theme: 'dark' | 'light';
  setupDone: boolean;
  lastSync: string | null;
}

export interface Category extends BaseRecord {
  name: string;
  color: string;
  icon: string;
  order: number; // max 12 active (validated in core)
  nameKey?: string; // i18n key for default names (translated with t() when shown)
}

export interface Transaction extends BaseRecord {
  date: string; // YYYY-MM-DD
  type: 'expense' | 'income';
  categoryId: string;
  description: string;
  amountCents: number; // integer >= 1, always positive
  currency: string; // ISO 4217
  groupId?: string;
  recurringId?: string;
}

export interface Salary extends BaseRecord {
  year: number;
  month: number; // 1-12
  amountCents: number;
}

export interface Budget extends BaseRecord {
  categoryId: string;
  limitCents: number;
  period: 'month';
  // Which year/month the limit applies to (needed for month-based budgets, SPEC §6.7).
  year: number;
  month: number;
}

export interface Goal extends BaseRecord {
  name: string;
  targetCents: number;
  currentCents: number;
  startDate: string; // YYYY-MM-DD
  targetDate?: string | null;
}

export interface Recurring extends BaseRecord {
  type: 'expense' | 'income';
  categoryId: string;
  description: string;
  amountCents: number;
  currency: string;
  frequency: 'weekly' | 'monthly' | 'yearly';
  nextDate: string; // YYYY-MM-DD
  endDate?: string | null;
}

export interface Group extends BaseRecord {
  name: string;
  color: string;
}

export interface ExchangeRateRow extends BaseRecord {
  base: string;
  rates: Record<string, number>;
  fetchedAt: string; // ISO
}

export class WalletDB extends Dexie {
  settings!: Table<SettingsRow>;
  categories!: Table<Category>;
  transactions!: Table<Transaction>;
  salaries!: Table<Salary>;
  budgets!: Table<Budget>;
  goals!: Table<Goal>;
  recurrings!: Table<Recurring>;
  groups!: Table<Group>;
  exchangeRates!: Table<ExchangeRateRow>;

  constructor(name = 'wallet') {
    super(name);
    // No ++id: id is a string UUID primary key (SPEC §5).
    this.version(1).stores({
      settings: 'id, language, country',
      categories: 'id, order, name',
      transactions: 'id, date, categoryId, type, currency, groupId, recurringId',
      salaries: 'id, year, month',
      budgets: 'id, categoryId',
      goals: 'id, startDate',
      recurrings: 'id, nextDate, endDate, categoryId',
      groups: 'id, name',
      exchangeRates: 'id, base',
    });
  }
}

export function createDatabase(name = 'wallet'): WalletDB {
  return new WalletDB(name);
}

// Default categories from SPEC §6.3, stored with i18n keys so the UI can translate them.
const DEFAULT_CATEGORY_KEYS = [
  ['catHome', '#2DD4BF'],
  ['catBills', '#F87171'],
  ['catFood', '#FFB020'],
  ['catTransport', '#60A5FA'],
  ['catHealth', '#34D399'],
  ['catPets', '#A78BFA'],
  ['catShopping', '#F472B6'],
  ['catLeisure', '#22D3EE'],
  ['catOther', '#9CA3AF'],
  ['catCar', '#EAB308'],
  ['catRent', '#FB7185'],
];

export async function seedDefaultCategories(db: WalletDB): Promise<void> {
  const active = await db.categories.filter((c) => c.deletedAt === null).count();
  if (active > 0) return;
  const rows: Category[] = DEFAULT_CATEGORY_KEYS.map(([nameKey, color], i) =>
    stampNew<Category>({ name: nameKey, color, icon: '', order: i, nameKey }),
  );
  await db.categories.bulkAdd(rows);
}

export async function seedSettings(db: WalletDB, defaults: Omit<SettingsRow, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<void> {
  await db.settings.put(stampNew<SettingsRow>(defaults));
}
