import { describe, it, expect } from 'vitest';
import { accountBalanceCents, netWorthCents, validateTransfer, suggestedSource, addTransfer, removeTransfer } from './accounts';
import type { Account, Transfer } from '../db/database';

const base = { createdAt: '', updatedAt: '', deletedAt: null };
const acc = (o: Partial<Account> & { id: string }): Account => ({ ...base, name: o.id, description: '', type: 'spending', currency: 'EUR', initialBalanceCents: 0, includeInNetWorth: true, isDefault: false, showOnHome: true, order: 0, ...o });
const tr = (from: string, to: string, amountCents: number): Transfer => ({ ...base, id: from + to + amountCents, fromAccountId: from, toAccountId: to, amountCents, date: '2026-01-10', note: '' });

describe('transferências', () => {
  const main = acc({ id: 'main', isDefault: true, initialBalanceCents: 100000 });
  const loan = acc({ id: 'loan', type: 'debt', initialBalanceCents: 50000 });
  const accounts = [main, loan];

  it('abate reduz a dívida e o saldo da origem, sem mexer no património líquido', () => {
    const before = netWorthCents(accounts, []);
    const t = [tr('main', 'loan', 20000)];
    expect(accountBalanceCents(main, [], accounts, 0, t)).toBe(80000);
    expect(accountBalanceCents(loan, [], accounts, 0, t)).toBe(30000);
    expect(netWorthCents(accounts, [], 0, t)).toBe(before);
  });
  it('transferências apagadas são ignoradas', () => {
    const t = [{ ...tr('main', 'loan', 20000), deletedAt: 'x' }];
    expect(accountBalanceCents(loan, [], accounts, 0, t)).toBe(50000);
  });
  it('valida valor, contas e moeda', () => {
    const ok = { fromAccountId: 'main', toAccountId: 'loan', amountCents: 100, date: '2026-01-10', note: '' };
    expect(validateTransfer(ok, accounts)).toBeNull();
    expect(validateTransfer({ ...ok, amountCents: 0 }, accounts)).toBe('amount');
    expect(validateTransfer({ ...ok, amountCents: 1.5 }, accounts)).toBe('amount');
    expect(validateTransfer({ ...ok, date: '10/01/2026' }, accounts)).toBe('date');
    expect(validateTransfer({ ...ok, toAccountId: 'main' }, accounts)).toBe('same');
    expect(validateTransfer({ ...ok, toAccountId: 'zzz' }, accounts)).toBe('missing');
    expect(validateTransfer(ok, [main, acc({ id: 'loan', type: 'debt', currency: 'USD' })])).toBe('currency');
  });
  it('sugere a conta predefinida como origem', () => {
    expect(suggestedSource(accounts, 'loan')?.id).toBe('main');
  });
});

// ── Transferências contam como despesa (Fase 10) ─────────────────────────────
function fakeDb() {
  const rows: Record<string, any[]> = { accounts: [], transfers: [], transactions: [] };
  const table = (name: string) => ({
    add: async (r: any) => { rows[name].push(r); },
    update: async (id: string, patch: any) => { const r = rows[name].find((x) => x.id === id); if (r) Object.assign(r, patch); },
    get: async (id: string) => rows[name].find((x) => x.id === id) ?? undefined,
    filter: (fn: (x: any) => boolean) => ({ toArray: async () => rows[name].filter(fn) }),
  });
  const db: any = { accounts: table('accounts'), transfers: table('transfers'), transactions: table('transactions') };
  return { db, rows };
}

describe('addTransfer cria despesa na categoria', () => {
  it('transferência com categoria gera uma transaction expense ligada', async () => {
    const { db, rows } = fakeDb();
    await db.accounts.add(acc({ id: 'main', isDefault: true, initialBalanceCents: 100000 }));
    await db.accounts.add(acc({ id: 'loan', type: 'debt', initialBalanceCents: 50000 }));
    const tr = await addTransfer(db, { fromAccountId: 'main', toAccountId: 'loan', amountCents: 20000, date: '2026-01-10', note: '', categoryId: 'cat-casa' });
    expect(rows.transactions.length).toBe(1);
    const tx = rows.transactions[0];
    expect(tx.type).toBe('expense');
    expect(tx.categoryId).toBe('cat-casa');
    expect(tx.amountCents).toBe(20000);
    expect(tx.accountId).toBe('main');
    expect(tr.transactionId).toBe(tx.id);
  });
  it('sem categoria não cria despesa (compatibilidade)', async () => {
    const { db, rows } = fakeDb();
    await db.accounts.add(acc({ id: 'main', isDefault: true }));
    await db.accounts.add(acc({ id: 'loan', type: 'debt' }));
    const tr = await addTransfer(db, { fromAccountId: 'main', toAccountId: 'loan', amountCents: 1000, date: '2026-01-10', note: '' });
    expect(rows.transactions.length).toBe(0);
    expect(tr.transactionId ?? null).toBe(null);
  });
  it('apagar a transferência apaga também a despesa', async () => {
    const { db, rows } = fakeDb();
    await db.accounts.add(acc({ id: 'main', isDefault: true }));
    await db.accounts.add(acc({ id: 'loan', type: 'debt' }));
    const tr = await addTransfer(db, { fromAccountId: 'main', toAccountId: 'loan', amountCents: 1000, date: '2026-01-10', note: '', categoryId: 'c' });
    await removeTransfer(db, tr.id);
    expect(rows.transactions[0].deletedAt).not.toBeNull();
  });
});
