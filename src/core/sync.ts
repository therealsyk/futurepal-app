// Offline-first sync helpers (SPEC §6.9 / §2 local-first).
// Pure logic so it can be unit-tested without a network connection.
// A row is "dirty" when updatedAt is newer than the last successful sync.
// Remote rows are merged by id: the row with the newer updatedAt wins.

export type SyncableRow = {
  id: string;
  updatedAt: string;
  deletedAt: string | null;
};

// Supabase table names (see supabase/schema.sql): the local Dexie table `recurrings`
// maps to the remote table `recurrings`.
export type SyncTable = 'settings' | 'categories' | 'transactions' | 'salaries' | 'budgets' | 'goals' | 'recurrings' | 'groups';

export const SYNC_TABLES: SyncTable[] = [
  'settings',
  'categories',
  'transactions',
  'salaries',
  'budgets',
  'goals',
  'recurrings',
  'groups',
];

// Rows that changed since the last sync (including soft-deletions, which are
// still valid changes that must be propagated).
export function changedSince<T extends SyncableRow>(rows: T[], lastSync: string | null): T[] {
  if (!lastSync) return rows.slice();
  return rows.filter((r) => r.updatedAt > lastSync);
}

// Merge a remote batch into a local list. For each id, keep the row whose
// updatedAt is newer. If timestamps tie, the local row wins (we are local-first).
export function mergeRows<T extends SyncableRow>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of local) byId.set(row.id, row);
  for (const row of remote) {
    const existing = byId.get(row.id);
    if (!existing || row.updatedAt > existing.updatedAt) {
      byId.set(row.id, row);
    }
  }
  return Array.from(byId.values());
}

// Build the payload to push to Supabase for one table.
export function buildPushPayload<T extends SyncableRow>(
  table: SyncTable,
  rows: T[],
  lastSync: string | null,
  userId: string,
): { table: SyncTable; rows: Array<T & { user_id: string }> } {
  const dirty = changedSince(rows, lastSync);
  return {
    table,
    rows: dirty.map((r) => ({ ...r, user_id: userId })),
  };
}

// Decide which remote rows are safe to apply: never overwrite a local row that
// was edited more recently than the remote copy.
export function applyRemote<T extends SyncableRow>(local: T[], remote: T[]): T[] {
  return mergeRows(local, remote);
}
