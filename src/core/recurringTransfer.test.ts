import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createDatabase } from '../db/database';
import { addRecurring, materializeDueRecurrings } from './finance';

describe('transferência recorrente', () => {
  it('cria transferências (e não despesas) em cada mês vencido', async () => {
    const db = createDatabase('rec-tr-' + Date.now());
    await addRecurring(db, { type: 'expense', categoryId: 'c', description: 'Poupança', amountCents: 50000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-09-05', endDate: null, accountId: 'a1', toAccountId: 'a2' });
    const n = await materializeDueRecurrings(db, '2026-11-20');
    expect(n).toBe(3);
    const trs = (await db.transfers.toArray()).sort((a, b) => a.date.localeCompare(b.date));
    expect(trs.map((t) => [t.date, t.fromAccountId, t.toAccountId, t.amountCents])).toEqual([
      ['2026-09-05', 'a1', 'a2', 50000], ['2026-10-05', 'a1', 'a2', 50000], ['2026-11-05', 'a1', 'a2', 50000],
    ]);
    expect(await db.transactions.count()).toBe(0);
  });
});
