// Liga as definições do aparelho (localStorage, lidas pela app) à tabela Dexie `settings` (sincronizada).
// Há UMA linha por utilizador, com id fixo, para que todos os aparelhos editem a mesma linha.
import type { WalletDB, SettingsRow } from '../db/database';
import type { AppSettings } from './settings';

export const SETTINGS_ROW_ID = 'app-settings';
const SAME = ['language', 'country', 'mainCurrency', 'firstDayOfWeek', 'dateFormat', 'theme'] as const;

function toRow(s: AppSettings, base: Partial<SettingsRow>, now: string): SettingsRow {
  return {
    id: SETTINGS_ROW_ID,
    createdAt: base.createdAt ?? now,
    updatedAt: s.updatedAt ?? now,
    deletedAt: null,
    language: s.language,
    country: s.country,
    mainCurrency: s.currency,
    firstDayOfWeek: s.firstDayOfWeek,
    dateFormat: s.dateFormat,
    theme: s.theme,
    setupDone: Boolean(s.country),
    lastSync: base.lastSync ?? null,
  };
}

/** Copia as definições para a linha fixa e apaga (soft delete) as linhas antigas com ids aleatórios. */
export async function mirrorSettings(db: WalletDB, s: AppSettings): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction('rw', db.settings, async () => {
    const rows = await db.settings.toArray();
    const current = rows.find((r) => r.id === SETTINGS_ROW_ID);
    // lastSync guardado numa linha antiga continua válido depois da migração
    const lastSync = current?.lastSync ?? rows.map((r) => r.lastSync).filter(Boolean).sort().pop() ?? null;
    for (const r of rows) {
      if (r.id !== SETTINGS_ROW_ID && r.deletedAt === null) await db.settings.put({ ...r, deletedAt: now, updatedAt: now });
    }
    // Sem alterações reais não se mexe na linha (senão cada arranque "ganhava" ao outro aparelho).
    const next = toRow(s, { ...current, lastSync }, s.updatedAt ?? current?.updatedAt ?? now);
    if (current && current.deletedAt === null && SAME.every((k) => current[k] === next[k])) return;
    await db.settings.put(next);
  });
}

/** Data da última sincronização deste aparelho (ou null). */
export async function getLastSync(db: WalletDB): Promise<string | null> {
  const rows = await db.settings.toArray();
  return rows.find((r) => r.id === SETTINGS_ROW_ID)?.lastSync ?? rows.map((r) => r.lastSync).filter(Boolean).sort().pop() ?? null;
}

/**
 * Depois de sincronizar: se a linha veio mais recente de outro aparelho, devolve as definições
 * a aplicar aqui (ou null se as locais já são as mais recentes).
 */
export async function remoteSettingsIfNewer(db: WalletDB, local: AppSettings): Promise<AppSettings | null> {
  const row = await db.settings.get(SETTINGS_ROW_ID);
  if (!row || row.deletedAt !== null || !row.country) return null;
  if (local.updatedAt && row.updatedAt <= local.updatedAt) return null;
  return {
    ...local,
    language: row.language,
    country: row.country,
    currency: row.mainCurrency,
    firstDayOfWeek: row.firstDayOfWeek,
    dateFormat: row.dateFormat,
    theme: row.theme,
    updatedAt: row.updatedAt,
  };
}
