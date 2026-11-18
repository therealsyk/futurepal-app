import type { WalletDB, Account, AccountType, Transaction, Transfer } from '../db/database';
import { stampNew } from '../db/database';

// ── Contas ───────────────────────────────────────────────────────────────
// Saldo = saldo inicial + rendimentos − despesas dos movimentos da conta.
// Movimentos sem accountId contam para a conta predefinida.

export const ALL_ACCOUNTS = 'all';
const ACTIVE_KEY = 'wallet.activeAccount';

export function getActiveAccountId(): string {
  try { return localStorage.getItem(ACTIVE_KEY) || ALL_ACCOUNTS; } catch { return ALL_ACCOUNTS; }
}
export function setActiveAccountId(id: string): void {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* sem armazenamento */ }
}

export async function listAccounts(db: WalletDB): Promise<Account[]> {
  const rows = await db.accounts.filter((a) => a.deletedAt === null).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

// Transação: evita duas contas "Principal" quando várias páginas chamam isto ao mesmo tempo.
export const DEFAULT_ACCOUNT_ID = 'acc-default';

export async function ensureDefaultAccount(db: WalletDB, currency: string, name: string): Promise<void> {
  await db.transaction('rw', db.accounts, async () => {
    const rows = await db.accounts.filter((a) => a.deletedAt === null).count();
    if (rows > 0) return;
    // id fixo: os aparelhos da mesma conta criam a mesma conta "Principal" (a sincronização não a duplica)
    await db.accounts.put({
      ...stampNew<Account>({ name, description: '', type: 'spending', currency, initialBalanceCents: 0, includeInNetWorth: true, isDefault: true, showOnHome: true, order: 0 }),
      id: DEFAULT_ACCOUNT_ID,
    });
  });
}

export interface NewAccount {
  name: string; description: string; type: AccountType; currency: string; initialBalanceCents: number;
  includeInNetWorth: boolean; isDefault: boolean; showOnHome: boolean;
}

export async function addAccount(db: WalletDB, input: NewAccount): Promise<Account> {
  const name = input.name.trim();
  if (!name) throw new Error('name required');
  const existing = await listAccounts(db);
  if (input.isDefault) {
    for (const a of existing.filter((x) => x.isDefault)) await db.accounts.update(a.id, { isDefault: false, updatedAt: new Date().toISOString() });
  }
  const acc = stampNew<Account>({ ...input, name, order: existing.length, isDefault: input.isDefault || existing.length === 0 });
  await db.accounts.add(acc);
  return acc;
}

export async function updateAccount(db: WalletDB, id: string, patch: Partial<NewAccount>): Promise<void> {
  if (patch.isDefault) {
    for (const a of await listAccounts(db)) if (a.isDefault && a.id !== id) await db.accounts.update(a.id, { isDefault: false });
  }
  await db.accounts.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

export async function removeAccount(db: WalletDB, id: string): Promise<void> {
  const all = await listAccounts(db);
  if (all.length <= 1) return; // tem de existir sempre uma conta
  const target = all.find((a) => a.id === id);
  await db.accounts.update(id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  if (target?.isDefault) {
    const next = all.find((a) => a.id !== id);
    if (next) await db.accounts.update(next.id, { isDefault: true });
  }
}

export function defaultAccountId(accounts: Account[]): string | undefined {
  return (accounts.find((a) => a.isDefault) ?? accounts[0])?.id;
}

// Movimentos de uma conta (ALL_ACCOUNTS = todos). Sem accountId → conta predefinida.
export function txsOfAccount(txs: Transaction[], accountId: string, accounts: Account[]): Transaction[] {
  if (accountId === ALL_ACCOUNTS) return txs;
  const def = defaultAccountId(accounts);
  return txs.filter((t) => (t.accountId ?? def) === accountId);
}

// Saldo de uma conta.
//  • salaryCents: salários já recebidos — contam para a conta predefinida.
//  • Conta normal: inicial + rendimentos − despesas + transferências recebidas − enviadas.
//  • Conta de dívida (o saldo é o valor em dívida): dinheiro que ENTRA (transferência/abate)
//    reduz a dívida; dinheiro que SAI (novo empréstimo) aumenta-a. Despesas reduzem-na (pagamento direto).
export function accountBalanceCents(acc: Account, txs: Transaction[], accounts: Account[], salaryCents = 0, transfers: Transfer[] = []): number {
  const def = defaultAccountId(accounts);
  let bal = acc.initialBalanceCents + (acc.id === def ? salaryCents : 0);
  // Despesa criada por uma transferência com categoria: conta nas estatísticas, mas o dinheiro já saiu pela
  // própria transferência (senão saía duas vezes do saldo).
  const fromTransfer = new Set(transfers.map((tr) => tr.transactionId).filter(Boolean) as string[]);
  for (const t of txs) {
    if (t.deletedAt !== null) continue;
    if (t.id.startsWith('sal-')) continue; // salário: já entra em salaryCents
    if (t.transferId || t.id.startsWith('tr-') || fromTransfer.has(t.id)) continue;
    if ((t.accountId ?? def) !== acc.id) continue;
    bal += t.type === 'income' ? t.amountCents : -t.amountCents;
  }
  const sign = acc.type === 'debt' ? -1 : 1;
  for (const tr of transfers) {
    if (tr.deletedAt !== null) continue;
    if (tr.toAccountId === acc.id) bal += sign * tr.amountCents;
    if (tr.fromAccountId === acc.id) bal -= sign * tr.amountCents;
  }
  return bal;
}

// Património líquido: dívidas contam como negativo.
export function netWorthCents(accounts: Account[], txs: Transaction[], salaryCents = 0, transfers: Transfer[] = []): number {
  return accounts
    .filter((a) => a.includeInNetWorth)
    .reduce((s, a) => {
      const b = accountBalanceCents(a, txs, accounts, salaryCents, transfers);
      return s + (a.type === 'debt' ? -Math.abs(b) : b);
    }, 0);
}

export async function loadTransfers(db: WalletDB): Promise<Transfer[]> {
  const rows = await db.transfers.filter((t) => t.deletedAt === null).toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export interface NewTransfer { fromAccountId: string; toAccountId: string; amountCents: number; date: string; note: string; categoryId?: string | null }

export type TransferError = 'amount' | 'same' | 'currency' | 'missing' | 'date';

// Valida e devolve o código do erro (ou null se estiver tudo certo).
export function validateTransfer(input: NewTransfer, accounts: Account[]): TransferError | null {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return 'amount';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'date';
  if (input.fromAccountId === input.toAccountId) return 'same';
  const from = accounts.find((a) => a.id === input.fromAccountId);
  const to = accounts.find((a) => a.id === input.toAccountId);
  if (!from || !to) return 'missing';
  if (from.currency !== to.currency) return 'currency';
  return null;
}

export async function addTransfer(db: WalletDB, input: NewTransfer): Promise<Transfer> {
  const err = validateTransfer(input, await listAccounts(db));
  if (err) throw new Error('transfer:' + err);
  const row = stampNew<Transfer>({ ...input, note: input.note.trim(), categoryId: input.categoryId ?? null });
  // A transferência fica registada como despesa na categoria escolhida (movimento da conta de origem).
  if (input.categoryId) {
    const tx = stampNew<Transaction>({
      date: input.date, type: 'expense', categoryId: input.categoryId,
      description: row.note || 'Transfer', amountCents: input.amountCents,
      currency: (await listAccounts(db)).find((a) => a.id === input.fromAccountId)?.currency ?? 'EUR',
      accountId: input.fromAccountId, transferId: row.id,
    });
    tx.id = 'tr-' + row.id; // id ligado à transferência: os outros aparelhos reconhecem-na depois de sincronizar
    await db.transactions.add(tx);
    row.transactionId = tx.id;
  }
  await db.transfers.add(row);
  return row;
}

export async function removeTransfer(db: WalletDB, id: string): Promise<void> {
  const tr = await db.transfers.get(id);
  if (tr?.transactionId) await db.transactions.update(tr.transactionId, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await db.transfers.update(id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

// Conta de origem sugerida para abater uma dívida: a predefinida (ou a primeira que não seja dívida).
export function suggestedSource(accounts: Account[], targetId: string): Account | undefined {
  const def = accounts.find((a) => a.isDefault && a.id !== targetId && a.type !== 'debt');
  return def ?? accounts.find((a) => a.id !== targetId && a.type !== 'debt');
}

export const CURRENCIES: Array<{ code: string; name: string }> = [
  { code: 'EUR', name: 'Euro' }, { code: 'USD', name: 'US Dollar' }, { code: 'GBP', name: 'British Pound' },
  { code: 'BRL', name: 'Real brasileiro' }, { code: 'CHF', name: 'Swiss Franc' }, { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' }, { code: 'JPY', name: 'Japanese Yen' }, { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'SEK', name: 'Swedish Krona' }, { code: 'NOK', name: 'Norwegian Krone' }, { code: 'DKK', name: 'Danish Krone' },
  { code: 'PLN', name: 'Polish Zloty' }, { code: 'CZK', name: 'Czech Koruna' }, { code: 'MXN', name: 'Mexican Peso' },
];

// Soma dos salários registados até ao mês indicado (inclusive).
export function salariesUntil(salaries: Array<{ year: number; month: number; amountCents: number; deletedAt: string | null }>, year: number, month: number): number {
  return salaries
    .filter((s) => s.deletedAt === null && (s.year < year || (s.year === year && s.month <= month)))
    .reduce((a, s) => a + s.amountCents, 0);
}
