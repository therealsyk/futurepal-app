// Unit tests for the Supabase sync layer using a fake client (no network).
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { syncNow } from './supabase-sync';
import { createDatabase } from '../db/database';

function fakeClient(rows: Record<string, any[]>) {
  // Minimal Supabase-like client: upsert merges by id; select().gt().eq() is chainable.
  return {
    from(table: string) {
      const store = rows[table] ?? [];
      return {
        upsert(list: any[]) {
          for (const r of list) {
            const i = store.findIndex((s) => s.id === r.id);
            if (i >= 0) store[i] = { ...store[i], ...r };
            else store.push(r);
          }
          rows[table] = store;
          return { error: null, data: store };
        },
        select() {
          const mk = (f: any[]) => ({
            data: f,
            error: null,
            gt: (c: string, v: string) => mk(f.filter((s) => s[c] > v)),
            eq: (c: string, v: string) => mk(f.filter((s) => s[c] === v)),
            order: () => mk(f),
            range: (a: number, b: number) => mk(f.slice(a, b + 1)),
          });
          return mk(store);
        },
      };
    },
  } as any;
}

describe('syncNow', () => {
  it('pushes local rows and pulls nothing on first sync (no remote data)', async () => {
    const db = createDatabase('sync-empty-' + Date.now());
    await db.settings.put({ id: 's1', language: 'pt-PT', country: 'PT', mainCurrency: 'EUR', firstDayOfWeek: 1, dateFormat: 'DMY', theme: 'dark', setupDone: true, lastSync: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', deletedAt: null });
    const client = fakeClient({});
    const res = await syncNow(client, db, 'user-1', null);
    expect(res.error).toBeUndefined();
    expect(res.pushed).toBe(1);
    expect(res.pulled).toBe(0);
    // Remote row mirrors camelCase -> snake_case mapping.
    expect(rowsCheck(client, 'settings')[0].main_currency).toBe('EUR');
  });

  it('merges a newer remote transaction into local by updatedAt', async () => {
    const db = createDatabase('sync-merge-' + Date.now());
    await db.transactions.put({ id: 't1', date: '2026-11-01', type: 'expense', categoryId: 'c1', description: 'old', amountCents: 100, currency: 'EUR', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', deletedAt: null });
    const remote = [{ id: 't1', user_id: 'user-1', date: '2026-11-01', type: 'expense', category_id: 'c1', description: 'from-phone', amount_cents: 250, currency: 'EUR', created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-03T00:00:00.000Z', deleted_at: null }];
    const client = fakeClient({ transactions: remote });
    const res = await syncNow(client, db, 'user-1', null);
    const t = await db.transactions.get('t1');
    expect(t!.description).toBe('from-phone');
    expect(t!.amountCents).toBe(250);
    expect(res.pulled).toBeGreaterThanOrEqual(1);
  });

  it('never overwrites a fresher local edit with an older remote row', async () => {
    const db = createDatabase('sync-fresh-' + Date.now());
    await db.transactions.put({ id: 't2', date: '2026-11-05', type: 'income', categoryId: 'c1', description: 'local-edit', amountCents: 900, currency: 'EUR', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z', deletedAt: null });
    const remote = [{ id: 't2', user_id: 'user-1', date: '2026-11-05', type: 'income', category_id: 'c1', description: 'stale-remote', amount_cents: 500, currency: 'EUR', created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-04T00:00:00.000Z', deleted_at: null }];
    const client = fakeClient({ transactions: remote });
    await syncNow(client, db, 'user-1', null);
    const t = await db.transactions.get('t2');
    expect(t!.description).toBe('local-edit');
    expect(t!.amountCents).toBe(900);
  });

  it('soft-deleted local rows are pushed (deleted_at set remotely)', async () => {
    const db = createDatabase('sync-delete-' + Date.now());
    await db.goals.put({ id: 'g1', name: 'gone', targetCents: 5000, currentCents: 0, startDate: '2026-11-01', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z', deletedAt: '2026-11-12T00:00:00.000Z' });
    const client = fakeClient({});
    await syncNow(client, db, 'user-1', null);
    expect(rowsCheck(client, 'goals')[0].deleted_at).toBe('2026-11-12T00:00:00.000Z');
  });

  it('records lastSync on the settings row after a successful sync', async () => {
    const db = createDatabase('sync-last-' + Date.now());
    await db.settings.put({ id: 's1', language: 'en', country: 'US', mainCurrency: 'USD', firstDayOfWeek: 0, dateFormat: 'MDY', theme: 'dark', setupDone: true, lastSync: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', deletedAt: null });
    const client = fakeClient({});
    const res = await syncNow(client, db, 'user-1', null);
    const s = await db.settings.get('s1');
    expect(s!.lastSync).toBe(res.lastSync);
  });

  it('returns an error string when a table push fails, without throwing', async () => {
    const db = createDatabase('sync-err-' + Date.now());
    await db.categories.put({ id: 'c1', name: 'catFood', color: '#2DD4BF', icon: '', order: 0, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', deletedAt: null });
    const client = {
      from() {
        const empty = (): any => ({ error: null, data: [], gt: () => empty(), eq: () => empty(), order: () => empty(), range: () => empty() });
        return { upsert: () => ({ error: { message: 'RLS violation' }, data: null }), select: () => empty() };
      },
    } as any;
    const res = await syncNow(client, db, 'user-1', null);
    expect(res.error).toContain('RLS violation');
  });
});

function rowsCheck(client: any, table: string): any[] {
  // The fake client keeps data in the closure object passed to fakeClient.
  return client.from(table).select().data;
}

describe('syncNow: reconciliação (não depende dos relógios)', () => {
  it('traz uma alteração do outro aparelho mesmo com hora anterior à última sincronização deste', async () => {
    const db = createDatabase('sync-clock-' + Date.now());
    const remote = [{ id: 't9', user_id: 'user-1', date: '2026-11-01', type: 'expense', category_id: 'c1', description: 'do PC', amount_cents: 500, currency: 'EUR', created_at: '2026-11-01T10:00:00+00:00', updated_at: '2026-11-01T10:00:00+00:00', deleted_at: null }];
    const client = fakeClient({ transactions: remote });
    await syncNow(client, db, 'user-1', '2026-11-01T11:00:00.000Z'); // este aparelho já tinha sincronizado às 11:00
    expect((await db.transactions.get('t9'))?.description).toBe('do PC');
  });
  it('envia linhas antigas que o servidor não tem (ex.: importadas de um backup)', async () => {
    const db = createDatabase('sync-old-' + Date.now());
    await db.transactions.put({ id: 'old', date: '2026-04-01', type: 'expense', categoryId: 'c1', description: 'backup', amountCents: 100, currency: 'EUR', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', deletedAt: null });
    const client = fakeClient({});
    const res = await syncNow(client, db, 'user-1', '2026-11-01T00:00:00.000Z');
    expect(res.error).toBeUndefined();
    expect(rowsCheck(client, 'transactions').map((r: any) => r.id)).toContain('old');
  });
  it('não volta a enviar o que já está igual no servidor', async () => {
    const db = createDatabase('sync-same-' + Date.now());
    await db.transactions.put({ id: 'same', date: '2026-04-01', type: 'expense', categoryId: 'c1', description: 'x', amountCents: 100, currency: 'EUR', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', deletedAt: null });
    const client = fakeClient({});
    await syncNow(client, db, 'user-1', null);
    const second = await syncNow(client, db, 'user-1', null);
    expect(second.pushed).toBe(0);
    expect(second.pulled).toBe(0);
  });
});
