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
  check: (fallbackRepo?: string) => Promise<{ version: string; notes: string } | null>;
  download: (fallbackRepo?: string) => Promise<boolean>;
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
  android: 'https://play.google.com/store/apps/details?id=com.futurepal.app',
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

// Android (APK fora da loja): lê a última release do GitHub, onde o APK é publicado com o instalador do Windows.
export const GITHUB_REPO = 'therealsyk/futurepal';
export interface GithubRelease { tag_name: string; body?: string | null; draft?: boolean; prerelease?: boolean; assets: Array<{ name: string; browser_download_url: string }> }

/** Versão e link do APK da release (função pura, testada). null se não houver APK. */
export function apkFromRelease(r: GithubRelease | null): { version: string; notes: string; url: string } | null {
  if (!r || r.draft || r.prerelease || !r.tag_name) return null;
  const apk = r.assets.find((x) => x.name.toLowerCase().endsWith('.apk'));
  if (!apk) return null;
  return { version: r.tag_name.replace(/^v/i, ''), notes: (r.body || '').trim(), url: apk.browser_download_url };
}

/** Última release publicada no GitHub: versão, novidades e o que tem (instalador do Windows e/ou APK). */
export async function githubLatest(fetcher: typeof fetch = fetch): Promise<{ version: string; notes: string; windows: boolean; apkUrl: string | null } | null> {
  try {
    const res = await fetcher(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const r = await res.json() as GithubRelease;
    if (!r?.tag_name || r.draft || r.prerelease) return null;
    const apk = r.assets.find((x) => x.name.toLowerCase().endsWith('.apk'));
    return { version: r.tag_name.replace(/^v/i, ''), notes: (r.body || '').trim(), windows: r.assets.some((x) => x.name === 'latest.yml'), apkUrl: apk?.browser_download_url ?? null };
  } catch { return null; }
}

export async function githubApk(fetcher: typeof fetch = fetch, fallbackRepo = ''): Promise<{ version: string; notes: string; url: string } | null> {
  const one = async (repo: string) => {
    const res = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(String(res.status));
    return apkFromRelease(await res.json() as GithubRelease);
  };
  try { return await one(GITHUB_REPO); } catch {
    // o repositório normal falhou: tenta o de reserva (painel de admin)
    if (!REPO_RE.test(fallbackRepo) || fallbackRepo === GITHUB_REPO) return null;
    try { return await one(fallbackRepo); } catch { return null; }
  }
}

/** Repositório de reserva das atualizações (tabela app_config, mudado no painel de admin). Vazio se não houver. */
export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export async function fallbackRepo(client: SupabaseClient | null): Promise<string> {
  if (!client) return '';
  try {
    const { data } = await client.from('app_config').select('value').eq('key', 'update_repo').maybeSingle();
    const v = String((data as { value?: string } | null)?.value ?? '').trim();
    return REPO_RE.test(v) ? v : '';
  } catch { return ''; }
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
