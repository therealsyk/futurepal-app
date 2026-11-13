import Dexie, { type Table } from 'dexie';

export interface Category {
  id?: number;
  name: string;
  isIncome: boolean;
}

export interface Transaction {
  id?: number;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // negative = expense, positive = income
  categoryId: number;
  note?: string;
}

export interface Salary {
  id?: number;
  month: number; // 1..12
  year: number;
  net: number;
  base?: number;
  bonus?: number;
  overtime?: number;
  deductions?: number;
  note?: string;
}

export interface Budget {
  id?: number;
  categoryId: number;
  limit: number;
  month?: number; // optional monthly override
  year?: number;
}

export interface SettingsRow {
  id?: number;
  key: string;
  value: Record<string, unknown>;
}

export class WalletDB extends Dexie {
  settings!: Table<SettingsRow>;
  categories!: Table<Category>;
  transactions!: Table<Transaction>;
  salaries!: Table<Salary>;
  budgets!: Table<Budget>;

  constructor(name = 'wallet') {
    super(name);
    this.version(1).stores({
      settings: '++id, key',
      categories: '++id, name',
      transactions: '++id, date, categoryId, amount',
      salaries: '++id, year, month',
      budgets: '++id, categoryId',
    });
  }
}

export function createDatabase(name = 'wallet'): WalletDB {
  const db = new WalletDB(name);
  return db;
}

export async function seedDefaults(db: WalletDB) {
  await db.settings.put({ id: 1, key: 'app', value: {} });
  if ((await db.categories.count()) === 0) {
    await db.categories.bulkAdd([
      { name: 'Salário', isIncome: true },
      { name: 'Alimentação', isIncome: false },
      { name: 'Transporte', isIncome: false },
      { name: 'Lazer', isIncome: false },
    ]);
  }
}
