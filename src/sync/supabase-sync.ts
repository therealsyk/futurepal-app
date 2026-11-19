// Phase 13 — Supabase sync (SPEC §2 local-first, §6.9).
// Push dirty local rows, pull remote rows newer than the last sync, merge by updatedAt.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletDB } from '../db/database';
import { changedSince, applyRemote, type SyncableRow, type SyncTable } from '../core/sync';

// Local (camelCase) <-> remote (snake_case) field maps, mirroring supabase/schema.sql.
const FIELD_MAP: Record<SyncTable, Record<string, string>> = {
  settings: { language: 'language', country: 'country', mainCurrency: 'main_currency', firstDayOfWeek: 'first_day_of_week', dateFormat: 'date_format', theme: 'theme', setupDone: 'setup_done' },
  categories: { name: 'name', color: 'color', icon: 'icon', order: 'order', nameKey: 'name_key', image: 'image', group: 'group_name' },
  transactions: { date: 'date', type: 'type', categoryId: 'category_id', description: 'description', amountCents: 'amount_cents', currency: 'currency', groupId: 'group_id', recurringId: 'recurring_id', accountId: 'account_id' },
  salaries: { year: 'year', month: 'month', amountCents: 'amount_cents' },
  budgets: { categoryId: 'category_id', limitCents: 'limit_cents', period: 'period', year: 'year', month: 'month' },
  goals: { name: 'name', targetCents: 'target_cents', currentCents: 'current_cents', startDate: 'start_date', targetDate: 'target_date', notes: 'notes', accountIds: 'account_ids' },
  recurrings: { type: 'type', categoryId: 'category_id', description: 'description', amountCents: 'amount_cents', currency: 'currency', frequency: 'frequency', nextDate: 'next_date', endDate: 'end_date', accountId: 'account_id' },
  groups: { name: 'name', color: 'color' },
  accounts: { name: 'name', description: 'description', type: 'type', currency: 'currency', initialBalanceCents: 'initial_balance_cents', includeInNetWorth: 'include_in_net_worth', isDefault: 'is_default', showOnHome: 'show_on_home', order: 'order' },
  transfers: { fromAccountId: 'from_account_id', toAccountId: 'to_account_id', amountCents: 'amount_cents', date: 'date', note: 'note' },
};

// Ordem importa pouco (não há chaves estrangeiras entre tabelas de dados), mas contas antes de movimentos é mais legível.
const TABLES: SyncTable[] = ['settings', 'categories', 'accounts', 'groups', 'transactions', 'transfers', 'salaries', 'budgets', 'goals', 'recurrings'];

function toRemote(table: SyncTable, row: any, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    user_id: userId, // obrigatório: a política RLS só aceita linhas do próprio utilizador
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt ?? null,
  };
  for (const [local, remote] of Object.entries(FIELD_MAP[table])) {
    if (row[local] !== undefined) out[remote] = row[local];
  }
  return out;
}

function toLocal(table: SyncTable, r: Record<string, unknown>): any {
  const out: any = {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
  for (const [local, remote] of Object.entries(FIELD_MAP[table])) {
    if (r[remote] !== undefined && r[remote] !== null) out[local] = r[remote];
  }
  return out;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  lastSync: string;
  error?: string;
}

/**
 * Full sync round-trip for one user.
 * - Push: every local row whose updatedAt is after `lastSync` (soft deletes included).
 * - Pull: remote rows with updated_at after `lastSync`, merged into Dexie by id
 *   (newer updatedAt wins — applyRemote semantics, never overwriting fresher local edits).
 */
export async function syncNow(client: SupabaseClient, db: WalletDB, userId: string, lastSync: string | null): Promise<SyncResult> {
  const now = new Date().toISOString();
  let pushed = 0;
  let pulled = 0;

  for (const table of TABLES) {
    const localTable = db[table as keyof WalletDB] as any;
    const local: SyncableRow[] = await localTable.toArray();

    // 1) Pull first: remote rows changed since the last sync.
    const since = lastSync ?? '1970-01-01T00:00:00.000Z';
    const { data, error } = await client
      .from(table)
      .select('*')
      .gt('updated_at', since)
      .eq('user_id', userId);
    if (error) return { pushed, pulled, lastSync: now, error: `${table}: ${error.message}` };

    const remote = (data ?? []).map((r: Record<string, unknown>) => toLocal(table, r));
    // 2) Merge (newer updatedAt wins; ties keep local, we are local-first).
    const merged = remote.length > 0 ? applyRemote(local, remote as SyncableRow[]) : local;
    // Linhas que acabaram de vir do servidor não voltam a ser enviadas.
    const localById = new Map(local.map((r) => [r.id, r]));
    const fromRemote = new Set(merged.filter((r) => localById.get(r.id) !== r).map((r) => r.id));
    if (remote.length > 0) {
      for (const row of merged) await localTable.put(row);
      pulled += remote.length;
    }

    // 3) Push only the merged rows that are newer than the last sync.
    const dirty = changedSince(merged, lastSync).filter((r) => !fromRemote.has(r.id));
    if (dirty.length > 0) {
      const rows = dirty.map((r) => toRemote(table, r, userId));
      const pushErr = await client.from(table).upsert(rows, { onConflict: 'user_id,id' }) // ids fixos ('acc-default', 'cat-…') repetem-se entre utilizadores (ver supabase/per_user_ids.sql);
      if (pushErr.error) return { pushed, pulled, lastSync: now, error: `${table}: ${pushErr.error.message}` };
      pushed += dirty.length;
    }
  }

  // Record lastSync on the settings row so the next run only compares newer edits.
  const settings = await db.settings.toArray();
  for (const s of settings.filter((r) => r.deletedAt === null)) {
    await db.settings.put({ ...s, lastSync: now, updatedAt: s.updatedAt });
  }

  return { pushed, pulled, lastSync: now };
}
