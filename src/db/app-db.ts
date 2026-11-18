import { createDatabase, type WalletDB } from './database';

// Uma base de dados local POR CONTA, para os dados de uma conta nunca passarem para outra:
//   'wallet'           -> quem usa a app sem conta
//   'wallet-u-<id>'    -> cada conta que já entrou neste aparelho
// O resto da app usa sempre `db`, que aponta para a base ativa (ver activateDatabaseFor).

export const GUEST_DB = 'wallet';
export const userDbName = (userId: string) => `wallet-u-${userId}`;
export const DB_CHANGED_EVENT = 'wallet:db-changed';

let current: WalletDB = createDatabase(GUEST_DB);
let currentName = GUEST_DB;

/** Base ativa, sempre atualizada (funciona como a instância Dexie, com métodos ligados a ela). */
export const db: WalletDB = new Proxy({} as WalletDB, {
  get(_target, prop) {
    const value = (current as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(current) : value;
  },
  set(_target, prop, value) {
    (current as unknown as Record<string | symbol, unknown>)[prop] = value;
    return true;
  },
});

export function currentDbName(): string {
  return currentName;
}

// Contas que já usaram este aparelho (para saber se é o primeiro login aqui).
const KNOWN_KEY = 'wallet.knownAccounts';
function knownAccounts(): string[] {
  try { return JSON.parse(localStorage.getItem(KNOWN_KEY) || '[]'); } catch { return []; }
}
function rememberAccount(userId: string): void {
  try { localStorage.setItem(KNOWN_KEY, JSON.stringify([...new Set([...knownAccounts(), userId])])); } catch { /* sem storage */ }
}

/**
 * Muda para a base da conta (ou para a base sem conta, com null).
 * firstTime = é a primeira vez que esta conta entra neste aparelho.
 */
export async function activateDatabaseFor(userId: string | null): Promise<{ changed: boolean; firstTime: boolean; name: string }> {
  const name = userId ? userDbName(userId) : GUEST_DB;
  const firstTime = Boolean(userId && !knownAccounts().includes(userId));
  if (userId) rememberAccount(userId);
  if (name === currentName) return { changed: false, firstTime, name };
  current.close();
  current = createDatabase(name);
  await current.open();
  currentName = name;
  try { window.dispatchEvent(new CustomEvent(DB_CHANGED_EVENT, { detail: name })); } catch { /* sem window (testes) */ }
  return { changed: true, firstTime, name };
}

// Tabelas com dados da pessoa (as categorias padrão e as definições não contam como "dados").
const DATA_TABLES = ['transactions', 'accounts', 'transfers', 'salaries', 'budgets', 'goals', 'recurrings', 'groups'] as const;
const ALL_TABLES = [...DATA_TABLES, 'categories', 'exchangeRates'] as const;

/** Quantos registos a pessoa criou sem conta (base 'wallet'). */
export async function guestDataCount(): Promise<number> {
  const guest = createDatabase(GUEST_DB);
  try {
    await guest.open();
    let n = 0;
    for (const t of DATA_TABLES) n += await guest.table(t).filter((r: { deletedAt?: string | null }) => !r.deletedAt).count();
    return n;
  } finally {
    guest.close();
  }
}

/**
 * Leva os dados criados sem conta para a base ativa (a da conta) e APAGA-OS da base sem conta,
 * para nunca poderem passar para outra conta. Devolve quantos registos foram movidos.
 */
export async function moveGuestDataIntoCurrent(): Promise<number> {
  if (currentName === GUEST_DB) return 0;
  const guest = createDatabase(GUEST_DB);
  await guest.open();
  let moved = 0;
  try {
    const now = new Date().toISOString();
    for (const t of ALL_TABLES) {
      const rows = await guest.table(t).toArray();
      if (rows.length === 0) continue;
      if (t === 'categories') {
        // categorias padrão já existem na conta (mesma chave): só se trazem as próprias da pessoa
        const existing = new Set((await current.categories.toArray()).map((c) => c.nameKey).filter(Boolean));
        const own = rows.filter((c: { nameKey?: string }) => !c.nameKey || !existing.has(c.nameKey));
        await current.table(t).bulkPut(own.map((r: object) => ({ ...r, updatedAt: now })));
        // as transações apontam para os ids das categorias padrão da base sem conta: remapeia pela chave
        const guestById = new Map(rows.map((c: { id: string; nameKey?: string }) => [c.id, c.nameKey]));
        const accountByKey = new Map((await current.categories.toArray()).filter((c) => c.nameKey).map((c) => [c.nameKey!, c.id]));
        remapCategory = (id: string) => { const k = guestById.get(id); return (k && accountByKey.get(k)) || id; };
        continue;
      }
      if (t === 'accounts') {
        // a conta "Principal" vazia criada automaticamente na conta dá lugar à conta predefinida que vem dos dados sem conta
        const auto = await current.accounts.get('acc-default');
        const guestHasDefault = rows.some((a: { id: string; isDefault?: boolean; deletedAt?: string | null }) => a.isDefault && !a.deletedAt && a.id !== 'acc-default');
        const autoUsed = auto ? await current.transactions.filter((x) => x.accountId === 'acc-default').count() : 0;
        if (auto && guestHasDefault && autoUsed === 0) await current.accounts.delete('acc-default');
      }
      await current.table(t).bulkPut(rows.map((r: object) => ({ ...r, updatedAt: now }))); // updatedAt novo -> sobem na próxima sincronização
      moved += rows.length;
    }
    // categorias referidas nas transações/orçamentos/recorrências
    for (const t of ['transactions', 'budgets', 'recurrings'] as const) {
      const rows = await current.table(t).toArray();
      const fixed = rows.filter((r: { categoryId?: string }) => r.categoryId && remapCategory(r.categoryId) !== r.categoryId)
        .map((r: { categoryId: string }) => ({ ...r, categoryId: remapCategory(r.categoryId) }));
      if (fixed.length) await current.table(t).bulkPut(fixed);
    }
    // apaga tudo da base sem conta (as definições do aparelho ficam no localStorage)
    await guest.transaction('rw', guest.tables, async () => { for (const tb of guest.tables) await tb.clear(); });
  } finally {
    guest.close();
    remapCategory = (id) => id;
  }
  return moved;
}
let remapCategory: (id: string) => string = (id) => id;

// Dev/test hook so Playwright can seed data; only exposed in dev builds.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __walletDb: WalletDB }).__walletDb = db;
