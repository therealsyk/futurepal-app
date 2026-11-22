// Phase 13 — Supabase sync (SPEC §2 local-first, §6.9).
// Push dirty local rows, pull remote rows newer than the last sync, merge by updatedAt.
import { DEFAULT_ACCOUNT_ID, PLACEHOLDER_AT } from '../core/accounts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletDB } from '../db/database';
import { applyRemote, type SyncableRow, type SyncTable } from '../core/sync';

// Local (camelCase) <-> remote (snake_case) field maps, mirroring supabase/schema.sql.
const FIELD_MAP: Record<SyncTable, Record<string, string>> = {
  settings: { language: 'language', country: 'country', mainCurrency: 'main_currency', firstDayOfWeek: 'first_day_of_week', dateFormat: 'date_format', theme: 'theme', setupDone: 'setup_done' },
  categories: { name: 'name', color: 'color', icon: 'icon', order: 'order', nameKey: 'name_key', image: 'image', group: 'group_name' },
  transactions: { date: 'date', type: 'type', categoryId: 'category_id', description: 'description', amountCents: 'amount_cents', currency: 'currency', groupId: 'group_id', recurringId: 'recurring_id', accountId: 'account_id' },
  salaries: { year: 'year', month: 'month', amountCents: 'amount_cents' },
  budgets: { categoryId: 'category_id', limitCents: 'limit_cents', period: 'period', year: 'year', month: 'month' },
  goals: { name: 'name', targetCents: 'target_cents', currentCents: 'current_cents', startDate: 'start_date', targetDate: 'target_date', notes: 'notes', accountIds: 'account_ids', contributions: 'contributions' },
  recurrings: { type: 'type', categoryId: 'category_id', description: 'description', amountCents: 'amount_cents', currency: 'currency', frequency: 'frequency', nextDate: 'next_date', endDate: 'end_date', accountId: 'account_id', toAccountId: 'to_account_id' },
  groups: { name: 'name', color: 'color', image: 'image' },
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

/** Datas do Postgres ("…+00:00") e do aparelho ("….000Z") no mesmo formato, para se poderem comparar. */
function iso(v: unknown): string {
  const d = new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? String(v ?? '') : d.toISOString();
}

const PAGE = 1000; // o Supabase devolve no máximo 1000 linhas por pedido
const CHUNK = 500;

/**
 * Sincronização completa de um utilizador, por reconciliação (não depende dos relógios dos aparelhos):
 * - Traz TODAS as linhas da conta no servidor (em páginas) e junta-as às locais: por id, ganha o updatedAt mais recente.
 * - Envia as linhas locais que o servidor não tem ou que são mais recentes do que a cópia do servidor.
 * Antes só se trazia/enviava o que tinha updatedAt depois da última sincronização DESTE aparelho; uma alteração
 * feita noutro aparelho antes dessa hora (ou dados importados de um backup) nunca chegava.
 */
export async function syncNow(client: SupabaseClient, db: WalletDB, userId: string, _lastSync: string | null): Promise<SyncResult> {
  const now = new Date().toISOString();
  let pushed = 0;
  let pulled = 0;

  for (const table of TABLES) {
    const localTable = db[table as keyof WalletDB] as any;
    let local: SyncableRow[] = (await localTable.toArray()).map((r: SyncableRow) => ({ ...r, updatedAt: iso(r.updatedAt) }));

    // 1) Tudo o que o servidor tem desta conta
    const remote: SyncableRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client.from(table).select('*').eq('user_id', userId).order('id').range(from, from + PAGE - 1);
      if (error) return { pushed, pulled, lastSync: now, error: `${table}: ${error.message}` };
      const rows = (data ?? []).map((r: Record<string, unknown>) => {
        const row = toLocal(table, r);
        row.updatedAt = iso(row.updatedAt);
        row.createdAt = iso(row.createdAt);
        if (row.deletedAt) row.deletedAt = iso(row.deletedAt);
        return row as SyncableRow;
      });
      remote.push(...rows);
      if (rows.length < PAGE) break;
    }
    const remoteById = new Map(remote.map((r) => [r.id, r]));

    // Conta automática deste aparelho, nunca usada, quando a nuvem já tem contas: sai (senão ficavam duas principais)
    if (table === 'accounts' && !remoteById.has(DEFAULT_ACCOUNT_ID) && remote.some((r) => r.deletedAt === null)) {
      const auto = local.find((r) => r.id === DEFAULT_ACCOUNT_ID && r.updatedAt === PLACEHOLDER_AT);
      const used = auto && (await db.transactions.filter((x) => x.accountId === DEFAULT_ACCOUNT_ID).count()
        + await db.transfers.filter((x) => x.fromAccountId === DEFAULT_ACCOUNT_ID || x.toAccountId === DEFAULT_ACCOUNT_ID).count()
        + await db.recurrings.filter((x) => x.accountId === DEFAULT_ACCOUNT_ID || x.toAccountId === DEFAULT_ACCOUNT_ID).count());
      if (auto && !used) { await db.accounts.delete(DEFAULT_ACCOUNT_ID); local = local.filter((r) => r !== auto); }
    }

    // 2) Juntar: por id ganha o mais recente; empate fica o local
    const merged = remote.length > 0 ? applyRemote(local, remote) : local;
    const localById = new Map(local.map((r) => [r.id, r]));
    const fromRemote = merged.filter((r) => localById.get(r.id) !== r);
    for (const row of fromRemote) await localTable.put(row);
    pulled += fromRemote.length;

    // 3) Enviar o que o servidor não tem ou tem mais antigo
    const dirty = merged.filter((r) => { const rr = remoteById.get(r.id); return !rr || r.updatedAt > rr.updatedAt; });
    for (let i = 0; i < dirty.length; i += CHUNK) {
      const rows = dirty.slice(i, i + CHUNK).map((r) => toRemote(table, r, userId));
      // ids fixos ('acc-default', 'cat-…') repetem-se entre utilizadores: a chave é (user_id, id) — ver supabase/per_user_ids.sql
      let pushErr = await client.from(table).upsert(rows, { onConflict: 'user_id,id' });
      // servidor ainda sem a coluna da foto dos grupos (supabase/group_image.sql): envia o resto e a foto fica neste aparelho
      if (table === 'groups' && pushErr.error && /image/i.test(pushErr.error.message)) pushErr = await client.from(table).upsert(rows.map(({ image: _foto, ...r }) => r), { onConflict: 'user_id,id' });
      if (pushErr.error) return { pushed, pulled, lastSync: now, error: `${table}: ${pushErr.error.message}` };
      pushed += rows.length;
    }
  }

  // Record lastSync on the settings row so the next run only compares newer edits.
  const settings = await db.settings.toArray();
  for (const s of settings.filter((r) => r.deletedAt === null)) {
    await db.settings.put({ ...s, lastSync: now, updatedAt: s.updatedAt });
  }

  return { pushed, pulled, lastSync: now };
}
