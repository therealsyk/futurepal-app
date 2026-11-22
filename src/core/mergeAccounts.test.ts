import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { createDatabase, type Account } from '../db/database';
import { accountBalanceCents, ensureDefaultAccount, PLACEHOLDER_AT, updateAccount } from './accounts';
import { duplicateDefaults, mergeDuplicateDefaults, repointMerged } from './mergeAccounts';

const at = '2026-01-01T00:00:00.000Z';
const stamp = { createdAt: at, updatedAt: at, deletedAt: null };
const acc = (o: Partial<Account> & { id: string }): Account => ({ name: o.id, description: '', type: 'spending', currency: 'EUR', initialBalanceCents: 0, includeInNetWorth: true, isDefault: true, showOnHome: true, order: 0, ...stamp, ...o });
const tx = (id: string, type: 'income' | 'expense', amountCents: number, accountId?: string) => ({ id, date: '2026-01-05', type, categoryId: 'c', description: '', amountCents, currency: 'EUR', accountId, ...stamp });
const tr = (id: string, from: string, to: string, amountCents: number) => ({ id, fromAccountId: from, toAccountId: to, amountCents, date: '2026-01-06', note: '', ...stamp });
let n = 0;
async function setup() {
  const db = createDatabase('merge-' + ++n);
  await db.open();
  await db.accounts.bulkAdd([
    acc({ id: 'acc-default', name: 'Principal' }), acc({ id: 'old', name: 'Main account', initialBalanceCents: 100, order: 1 }),
    acc({ id: 'sav', type: 'savings', isDefault: false }), acc({ id: 'debt', type: 'debt', isDefault: false, initialBalanceCents: 6460000 }),
  ]);
  await db.transactions.bulkAdd([tx('a', 'income', 2505762), tx('b', 'expense', 367132, 'old')] as never);
  await db.transfers.bulkAdd([tr('t', 'acc-default', 'old', 5000), tr('u', 'acc-default', 'debt', 700)] as never);
  return db;
}

describe('juntar contas principais repetidas', () => {
  it('fica uma só conta com o mesmo total e sem apagar movimentos', async () => {
    const db = await setup();
    const total = await mergeDuplicateDefaults(db);
    expect(total).toBe(2505762 + 100 - 367132 - 700);
    const live = (await db.accounts.toArray()).filter((a) => a.deletedAt === null);
    expect(live.filter((a) => a.isDefault).map((a) => a.id)).toEqual(['old']);
    const main = live.find((a) => a.id === 'old')!;
    expect(accountBalanceCents(main, await db.transactions.toArray(), live, 0, await db.transfers.toArray())).toBe(total);
    expect((await db.transactions.toArray()).every((x) => x.deletedAt === null)).toBe(true);
    expect(await mergeDuplicateDefaults(db)).toBeNull();
  });
  it('movimentos que chegam depois à conta retirada passam para a que ficou', async () => {
    const db = await setup();
    await mergeDuplicateDefaults(db);
    await db.transactions.add(tx('late', 'expense', 10, 'acc-default') as never);
    await repointMerged(db);
    expect((await db.transactions.get('late'))!.accountId).toBe('old');
  });
  it('não mexe em moedas diferentes nem numa só conta principal', () => {
    expect(duplicateDefaults([])).toEqual([]);
    expect(duplicateDefaults([acc({ id: 'x' }), acc({ id: 'y', currency: 'USD' })])).toEqual([]);
    expect(duplicateDefaults([acc({ id: 'x' }), acc({ id: 'y', isDefault: false })])).toEqual([]);
  });
  it('a conta automática tem data antiga, e editá-la passa a contar', async () => {
    const db = createDatabase('merge-' + ++n);
    await db.open();
    await ensureDefaultAccount(db, 'EUR', 'Principal');
    expect((await db.accounts.get('acc-default'))!.updatedAt).toBe(PLACEHOLDER_AT);
    await updateAccount(db, 'acc-default', { name: 'Banco' });
    expect((await db.accounts.get('acc-default'))!.updatedAt > PLACEHOLDER_AT).toBe(true);
  });
});
