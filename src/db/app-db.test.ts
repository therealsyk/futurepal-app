import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, activateDatabaseFor, currentDbName, guestDataCount, moveGuestDataIntoCurrent, GUEST_DB, userDbName } from './app-db';
import { ensureDefaultCategories, addTransaction, activeCategories } from '../core/finance';
import { ensureDefaultAccount, listAccounts, addAccount } from '../core/accounts';

// localStorage mínimo para o registo de contas conhecidas
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;

async function addSpend(desc: string, cents: number) {
  const cat = (await activeCategories(db)).find((c) => c.nameKey === 'catFood')!;
  const acc = (await listAccounts(db))[0];
  return addTransaction(db, { date: '2026-11-10', type: 'expense', categoryId: cat.id, description: desc, amountCents: cents, currency: 'EUR', accountId: acc.id });
}

beforeEach(async () => {
  store.clear();
  await activateDatabaseFor(null);
  await db.delete(); await db.open();
});

describe('one local database per account', () => {
  it('switching accounts switches data: A never sees B and vice versa', async () => {
    await activateDatabaseFor('user-a');
    expect(currentDbName()).toBe(userDbName('user-a'));
    await ensureDefaultCategories(db); await ensureDefaultAccount(db, 'EUR', 'Principal');
    await addSpend('compra da A', 1000);

    await activateDatabaseFor('user-b');
    await ensureDefaultCategories(db); await ensureDefaultAccount(db, 'EUR', 'Principal');
    expect(await db.transactions.count()).toBe(0); // B não vê nada da A
    await addSpend('compra da B', 2000);

    await activateDatabaseFor('user-a');
    const a = await db.transactions.toArray();
    expect(a.map((t) => t.description)).toEqual(['compra da A']);

    await activateDatabaseFor(null); // terminar sessão: base sem conta, vazia
    expect(currentDbName()).toBe(GUEST_DB);
    expect(await db.transactions.count()).toBe(0);
  });

  it('first time detection only on the first login of each account on this device', async () => {
    expect((await activateDatabaseFor('user-c')).firstTime).toBe(true);
    await activateDatabaseFor(null);
    expect((await activateDatabaseFor('user-c')).firstTime).toBe(false);
  });

  it('data made without an account is MOVED (not copied) into the account that accepts it', async () => {
    // sem conta: categorias com ids aleatórios (instalação antiga) + conta própria + 2 despesas
    await ensureDefaultCategories(db);
    const acc = await addAccount(db, { name: 'Conta do banco', description: '', type: 'spending', currency: 'EUR', initialBalanceCents: 0, includeInNetWorth: true, isDefault: true, showOnHome: true });
    await addSpend('café', 150); await addSpend('jantar', 3000);
    expect(await guestDataCount()).toBe(3); // 1 conta + 2 transações

    await activateDatabaseFor('user-d');
    await ensureDefaultCategories(db); await ensureDefaultAccount(db, 'EUR', 'Principal'); // a app cria isto ao entrar
    const moved = await moveGuestDataIntoCurrent();
    expect(moved).toBe(3);
    const accounts = await listAccounts(db);
    expect(accounts.map((a) => a.name)).toEqual(['Conta do banco']); // a "Principal" vazia automática saiu
    const txs = await db.transactions.toArray();
    expect(txs).toHaveLength(2);
    expect(txs.every((t) => t.accountId === acc.id)).toBe(true);
    const food = (await activeCategories(db)).find((c) => c.nameKey === 'catFood')!;
    expect(txs.every((t) => t.categoryId === food.id)).toBe(true); // categoria remapeada para a da conta
    expect((await activeCategories(db)).length).toBe((await activeCategories(db)).filter((c, i, all) => all.findIndex((x) => x.nameKey === c.nameKey) === i).length); // sem duplicados

    expect(await guestDataCount()).toBe(0); // saiu da base sem conta: nunca pode ir para outra conta
    await activateDatabaseFor('user-e');
    expect(await db.transactions.count()).toBe(0);
  });
});
