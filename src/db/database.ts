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
  theme: 'dark' | 'light' | 'gray';
  setupDone: boolean;
  lastSync: string | null;
}

export interface Category extends BaseRecord {
  name: string;
  color: string;
  icon: string;
  order: number;
  nameKey?: string; // i18n key for default names (translated with t() when shown)
  image?: string; // imagem própria (data-URI) escolhida pela pessoa; sem ela mostra-se o ícone
  group?: string; // grupo do catálogo (housing, food…) ou 'custom'
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
  accountId?: string; // sem valor = conta predefinida
  transferId?: string; // preenchido quando a despesa nasce de uma transferência entre contas
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
  notes?: string;
  accountIds?: string[]; // contas que alimentam a meta (opcional)
  contributions?: Array<{ date: string; cents: number }>; // cada vez que se junta dinheiro (para a previsão por padrões)
}

export type RecurringFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'yearly';

export interface Recurring extends BaseRecord {
  type: 'expense' | 'income';
  categoryId: string;
  description: string;
  amountCents: number;
  currency: string;
  frequency: RecurringFrequency;
  accountId?: string;
  nextDate: string; // YYYY-MM-DD
  endDate?: string | null;
  toAccountId?: string; // preenchido = transferência recorrente (de accountId para toAccountId)
}

export interface Group extends BaseRecord {
  name: string;
  color: string;
  image?: string; // foto própria (data-URI pequena); vazia ou sem ela mostra-se o ícone
}

// Conta (Gastos / Poupança / Dívida) — como no app do telemóvel.
export type AccountType = 'spending' | 'savings' | 'debt';
export interface Account extends BaseRecord {
  name: string;
  description: string;
  type: AccountType;
  currency: string; // ISO 4217
  initialBalanceCents: number; // pode ser negativo (dívida)
  includeInNetWorth: boolean;
  isDefault: boolean;
  showOnHome: boolean;
  order: number;
}

// Transferência entre contas (ex.: salário → abate de uma dívida).
// Conta como DESPESA na categoria escolhida (pedido do Rafael); o património líquido
// não muda, porque a origem perde exatamente o valor transferido.
export interface Transfer extends BaseRecord {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number; // inteiro >= 1
  date: string; // YYYY-MM-DD
  note: string;
  categoryId?: string | null;   // categoria da despesa associada
  transactionId?: string | null; // transação expense criada automaticamente
}

// Garantia de um produto (Plus): guardada só neste aparelho.
export interface Warranty extends BaseRecord {
  name: string;
  purchaseDate: string; // YYYY-MM-DD
  months: number;
  store: string;
  note: string;
  priceCents: number;
}

// Marca de uma transação como profissional (plano Pro): id = id da transação.
export interface TxTag extends BaseRecord {
  business: boolean;
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
  accounts!: Table<Account>;
  transfers!: Table<Transfer>;
  warranties!: Table<Warranty>;
  txTags!: Table<TxTag>;

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
    // v2: contas. Movimentos antigos (sem accountId) pertencem à conta predefinida.
    this.version(2).stores({
      accounts: 'id, type, order',
    });
    // v3: transferências entre contas.
    this.version(3).stores({
      transfers: 'id, date, fromAccountId, toAccountId',
    });
    // v4: garantias e marcas de transações profissionais (FuturePal Plus/Pro; ainda não sincronizadas).
    this.version(4).stores({
      warranties: 'id, purchaseDate',
      txTags: 'id',
    });
  }
}

export function createDatabase(name = 'wallet'): WalletDB {
  return new WalletDB(name);
}

// As categorias padrão vivem só em core/finance.ts (DEFAULT_CATEGORY_DEFS + ensureDefaultCategories);
// as definições sincronizadas em core/settingsSync.ts.
