// Duas contas principais na mesma pessoa (ex.: um aparelho novo criou a automática antes de sincronizar).
// A junção só corre quando a pessoa a pede, não apaga movimentos e é anulada se o total mudar um cêntimo.
import type { Account, WalletDB } from '../db/database';
import { accountBalanceCents, DEFAULT_ACCOUNT_ID } from './accounts';

const MERGED = 'merged:'; // marca na conta retirada: "merged:<id da conta que ficou>"

/** Contas de gastos principais repetidas, na mesma moeda. A primeira é a que fica (a original, não a automática). */
export function duplicateDefaults(accounts: Account[]): Account[] {
  const mains = accounts.filter((a) => a.deletedAt === null && a.isDefault && a.type === 'spending');
  const auto = (a: Account) => (a.id === DEFAULT_ACCOUNT_ID ? 1 : 0);
  mains.sort((a, b) => auto(a) - auto(b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const same = mains.filter((a) => a.currency === mains[0].currency);
  return same.length > 1 ? same : [];
}

async function repoint(db: WalletDB, from: string, to: string, now: string): Promise<void> {
  const swap = (id?: string) => (id === from ? to : id);
  for (const x of await db.transactions.toArray()) {
    if (x.accountId === from) await db.transactions.update(x.id, { accountId: to, updatedAt: now });
  }
  for (const x of await db.transfers.toArray()) {
    if (x.fromAccountId === from || x.toAccountId === from) await db.transfers.update(x.id, { fromAccountId: swap(x.fromAccountId)!, toAccountId: swap(x.toAccountId)!, updatedAt: now });
  }
  for (const x of await db.recurrings.toArray()) {
    if (x.accountId === from || x.toAccountId === from) await db.recurrings.update(x.id, { accountId: swap(x.accountId), toAccountId: swap(x.toAccountId), updatedAt: now });
  }
  for (const x of await db.goals.toArray()) {
    if (x.accountIds?.includes(from)) await db.goals.update(x.id, { accountIds: [...new Set(x.accountIds.map((i) => swap(i)!))], updatedAt: now });
  }
}

/** Soma dos saldos: dinheiro nas contas e, à parte, as dívidas. */
async function totals(db: WalletDB): Promise<{ money: number; debt: number }> {
  const accounts = (await db.accounts.toArray()).filter((a) => a.deletedAt === null);
  const txs = (await db.transactions.toArray()).filter((x) => x.deletedAt === null);
  const trs = (await db.transfers.toArray()).filter((x) => x.deletedAt === null);
  const n = new Date(), ym = n.getFullYear() * 100 + n.getMonth() + 1;
  const sal = (await db.salaries.toArray()).filter((x) => x.deletedAt === null && x.year * 100 + x.month <= ym).reduce((s, x) => s + x.amountCents, 0);
  const sum = (debt: boolean) => accounts.filter((a) => (a.type === 'debt') === debt).reduce((s, a) => s + accountBalanceCents(a, txs, accounts, sal, trs), 0);
  return { money: sum(false), debt: sum(true) };
}

/** Junta as contas principais repetidas numa só. Devolve o total (igual ao de antes) ou null se não havia nada a juntar. */
export async function mergeDuplicateDefaults(db: WalletDB): Promise<number | null> {
  return db.transaction('rw', [db.accounts, db.transactions, db.transfers, db.recurrings, db.goals, db.salaries], async () => {
    const [keep, ...dups] = duplicateDefaults(await db.accounts.toArray());
    if (!keep) return null;
    const before = await totals(db);
    const now = new Date().toISOString();
    for (const d of dups) {
      await repoint(db, d.id, keep.id, now);
      await db.accounts.update(d.id, { deletedAt: now, updatedAt: now, isDefault: false, description: MERGED + keep.id });
    }
    await db.accounts.update(keep.id, { initialBalanceCents: keep.initialBalanceCents + dups.reduce((s, d) => s + d.initialBalanceCents, 0), updatedAt: now });
    const after = await totals(db);
    if (after.money !== before.money || after.debt !== before.debt) throw new Error('balance changed'); // anula tudo
    return after.money;
  });
}

/** Depois de sincronizar: movimentos que outro aparelho ainda registou na conta retirada passam para a que ficou. */
export async function repointMerged(db: WalletDB): Promise<void> {
  const all = await db.accounts.toArray();
  for (const a of all) {
    if (a.deletedAt === null || !a.description?.startsWith(MERGED)) continue;
    const to = a.description.slice(MERGED.length);
    if (all.some((x) => x.id === to && x.deletedAt === null)) await repoint(db, a.id, to, new Date().toISOString());
  }
}
