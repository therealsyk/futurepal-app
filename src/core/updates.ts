// Aviso de atualizações. A app compara a sua versão com a tabela `app_versions` do Supabase
// (uma linha por plataforma). O código novo NÃO vem do Supabase: vem da loja (Android/iPhone)
// ou do GitHub Releases (Windows, via electron-updater). O Supabase só diz "há versão nova".
import type { SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { APP_VERSION, compareVersions } from './version';

export type Platform = 'windows' | 'android' | 'ios' | 'web';
export type UpdateStatus = 'current' | 'available' | 'required' | 'unknown';

export interface VersionRow {
  platform: Platform;
  latest_version: string;
  min_version: string;
  notes: string;
  download_url: string;
}

export interface UpdateInfo {
  status: UpdateStatus;
  platform: Platform;
  current: string;
  latest?: string;
  notes?: string;
  url?: string;
}

// Ponte do Electron (electron/preload.js) para o atualizador do Windows.
export interface DesktopUpdater {
  supported: boolean; // false no .exe portátil ou em desenvolvimento
  check: () => Promise<{ version: string; notes: string } | null>;
  download: () => Promise<boolean>;
  install: () => void;
  onProgress: (cb: (percent: number) => void) => () => void;
}

export function desktopUpdater(): DesktopUpdater | null {
  const b = (globalThis as unknown as { __electronBridge?: { updates?: DesktopUpdater } }).__electronBridge;
  return b?.updates ?? null;
}

export function currentPlatform(): Platform {
  if ((globalThis as unknown as { __electronBridge?: unknown }).__electronBridge) return 'windows';
  const p = Capacitor.getPlatform();
  return p === 'android' || p === 'ios' ? p : 'web';
}

export const STORE_URLS: Partial<Record<Platform, string>> = {
  android: 'https://play.google.com/store/apps/details?id=com.rafael.wallet',
};

/** Decide o estado a partir da linha da tabela (função pura, testada). */
export function evaluate(row: VersionRow | null, current: string, platform: Platform): UpdateInfo {
  if (!row || !row.latest_version) return { status: 'unknown', platform, current };
  const base = { platform, current, latest: row.latest_version, notes: row.notes || '', url: row.download_url || STORE_URLS[platform] || '' };
  if (row.min_version && compareVersions(current, row.min_version) < 0) return { status: 'required', ...base };
  if (compareVersions(current, row.latest_version) < 0) return { status: 'available', ...base };
  return { status: 'current', ...base };
}

export async function checkForUpdate(client: SupabaseClient | null, platform = currentPlatform(), current = APP_VERSION): Promise<UpdateInfo> {
  if (!client) return { status: 'unknown', platform, current };
  try {
    const { data, error } = await client.from('app_versions').select('*').eq('platform', platform).maybeSingle();
    if (error) return { status: 'unknown', platform, current };
    return evaluate(data as VersionRow | null, current, platform);
  } catch {
    return { status: 'unknown', platform, current };
  }
}

// "Agora não": não volta a avisar desta versão (mas avisa da seguinte).
const DISMISS_KEY = 'wallet.updateDismissed';
export function isDismissed(version: string): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === version; } catch { return false; }
}
export function dismiss(version: string): void {
  try { localStorage.setItem(DISMISS_KEY, version); } catch { /* sem storage */ }
}

/** Abre a loja / página de download fora da app. */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  if (Capacitor.isNativePlatform()) {
    const { AppLauncher } = await import('@capacitor/app-launcher');
    await AppLauncher.openUrl({ url });
    return;
  }
  window.open(url, '_blank', 'noopener'); // no Electron, main.js abre no browser do sistema
}
