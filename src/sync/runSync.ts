// Uma sincronização completa, igual em todo o lado (App ao abrir, botão nas Definições, login no setup):
// sincroniza as tabelas e, se as definições vieram mais recentes de outro aparelho, aplica-as aqui.
import type { SupabaseClient } from '@supabase/supabase-js';
import i18n from 'i18next';
import type { WalletDB } from '../db/database';
import { syncNow, type SyncResult } from './supabase-sync';
import { getLastSync, remoteSettingsIfNewer } from '../core/settingsSync';
import { loadSettings, saveSettings, setTheme, type AppSettings } from '../core/settings';

export async function runSync(client: SupabaseClient, db: WalletDB, userId: string): Promise<SyncResult & { settings: AppSettings | null }> {
  const result = await syncNow(client, db, userId, await getLastSync(db));
  let settings: AppSettings | null = null;
  if (!result.error) {
    settings = await remoteSettingsIfNewer(db, loadSettings());
    if (settings) {
      saveSettings(settings, { silent: true });
      setTheme(settings.theme);
      if (i18n.language !== settings.language) i18n.changeLanguage(settings.language);
    }
  }
  return { ...result, settings };
}
