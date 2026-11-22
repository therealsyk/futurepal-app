import logoUrl from '../assets/logo.svg';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { registerPlugin, Capacitor } from '@capacitor/core';
import { checkForUpdate, GITHUB_REPO, desktopUpdater, githubApk, dismiss, isDismissed, openExternal, type UpdateInfo } from '../core/updates';
import { compareVersions } from '../core/version';

// Aviso de atualização (banner) ou bloqueio (versão abaixo da mínima). Verifica ao abrir e de 6 em 6 horas.
const EVERY_MS = 6 * 60 * 60 * 1000;
export const UPDATE_CHECK_EVENT = 'wallet:update-check'; // as Definições pedem uma verificação manual

// Plugin nativo (android/.../ApkUpdaterPlugin.java): descarrega o APK dentro da app e abre o instalador.
const ApkUpdater = registerPlugin<{ downloadAndInstall: (o: { url: string }) => Promise<void>; addListener: (e: 'progress', cb: (d: { percent: number }) => void) => Promise<{ remove: () => void }> }>('ApkUpdater');

type Phase = 'idle' | 'downloading' | 'installing' | 'ready' | 'error';

/** Junta a tabela do Supabase com o atualizador nativo do Windows (GitHub Releases). */
export async function fullCheck(): Promise<UpdateInfo> {
  const info = await checkForUpdate(getSupabase());
  const du = desktopUpdater();
  if (info.platform === 'windows' && du?.supported) {
    try {
      const native = await du.check();
      if (native && compareVersions(native.version, info.current) > 0 && info.status !== 'required') {
        return { ...info, status: 'available', latest: native.version, notes: native.notes || info.notes };
      }
    } catch { /* sem internet ou sem releases: fica o resultado do Supabase */ }
  }
  // Android: a versão nova é o APK da última release do GitHub (não precisa da tabela do Supabase).
  if (info.platform === 'android' && info.status !== 'required') {
    const apk = await githubApk();
    if (apk && compareVersions(apk.version, info.current) > 0) return { ...info, status: 'available', latest: apk.version, notes: apk.notes || info.notes, url: apk.url };
  }
  return info;
}

export function UpdateNotice() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);

  const run = useCallback(async (manual = false) => {
    const r = await fullCheck();
    setInfo(r);
    setHidden(!manual && !!r.latest && r.status === 'available' && isDismissed(r.latest));
  }, []);

  useEffect(() => {
    run().catch(() => {});
    const id = setInterval(() => { run().catch(() => {}); }, EVERY_MS);
    const onManual = () => { run(true).catch(() => {}); };
    window.addEventListener(UPDATE_CHECK_EVENT, onManual);
    return () => { clearInterval(id); window.removeEventListener(UPDATE_CHECK_EVENT, onManual); };
  }, [run]);

  if (!info || (info.status !== 'available' && info.status !== 'required') || (hidden && info.status === 'available')) return null;

  const du = desktopUpdater();
  const nativeWin = info.platform === 'windows' && du?.supported;
  const nativeApk = info.platform === 'android' && Capacitor.isNativePlatform() && /\.apk(\?|$)/i.test(info.url || '');

  const update = async () => {
    if (nativeWin && du) {
      if (phase === 'ready') { du.install(); return; }
      setPhase('downloading'); setPercent(0);
      const off = du.onProgress((p) => setPercent(Math.round(p)));
      try {
        const ok = await du.download();
        if (!ok) { setPhase('error'); await openExternal(`https://github.com/${GITHUB_REPO}/releases/latest`); return; }
        // um só clique: descarregou, instala logo. Se a app não fechar (instalação bloqueada), volta o botão.
        setPhase('installing'); setPercent(100);
        setTimeout(() => du.install(), 600);
        setTimeout(() => setPhase('ready'), 45_000);
      } catch {
        setPhase('error');
      } finally {
        off();
      }
      return;
    }
    const apkUrl = info.url || '';
    if (info.platform === 'android' && Capacitor.isNativePlatform() && /\.apk(\?|$)/i.test(apkUrl)) {
      setPhase('downloading'); setPercent(0);
      const h = await ApkUpdater.addListener('progress', (d) => setPercent(d.percent));
      try { await ApkUpdater.downloadAndInstall({ url: apkUrl }); setPhase('idle'); }
      catch { setPhase('error'); }
      finally { h.remove(); }
      return;
    }
    await openExternal(apkUrl);
  };

  const label = phase === 'downloading' ? t('updates.downloading', { percent })
    : phase === 'ready' ? t('updates.restart')
    : nativeWin || nativeApk ? t('updates.downloadInstall')
    // Android fora da Play Store (APK no GitHub): o link descarrega a versão nova, não abre a loja
    : (info.platform === 'android' || info.platform === 'ios') && !/github\.com|\.apk(\?|$)/i.test(info.url || '') ? t('updates.openStore')
    : t('updates.download');
  const canAct = phase !== 'downloading' && (nativeWin || !!info.url);
  const body = (
    <>
      <div className="up-text">
        <b>{info.status === 'required' ? t('updates.requiredTitle') : t('updates.availableTitle', { version: info.latest })}</b>
        <span>{info.status === 'required' ? t('updates.requiredText', { version: info.latest, current: info.current }) : t('updates.availableText', { current: info.current })}</span>
        {info.notes ? <small>{info.notes}</small> : null}
        {phase === 'downloading' && <i className="up-bar" style={{ width: `${percent}%` }} />}
        {phase === 'error' && <small className="up-err">{t('updates.error')}</small>}
        {!canAct && phase !== 'downloading' && <small>{t('updates.noLink')}</small>}
      </div>
      <div className="up-actions">
        {info.status === 'available' && phase === 'idle' && (
          <button type="button" className="fx-btn" onClick={() => { if (info.latest) dismiss(info.latest); setHidden(true); }}>{t('updates.later')}</button>
        )}
        <button type="button" className="fx-btn primary" disabled={!canAct} onClick={update} data-testid="update-action">{label}</button>
      </div>
    </>
  );

  if (phase === 'downloading' || phase === 'installing') {
    return (
      <div className="up-block" role="alertdialog" aria-modal="true" aria-label={t('updates.availableTitle', { version: info.latest })}>
        <div className="up-card up-progress">
          <span className="up-logo"><img src={logoUrl} alt="" /></span>
          <b>{t('updates.wait')}</b>
          <span>{t(phase === 'installing' ? 'updates.waitInstall' : 'updates.waitText', { version: info.latest })}</span>
          <div className="up-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i className="up-bar" style={{ width: `${percent}%` }} /></div>
          <small>{phase === 'installing' ? t('updates.installing') : t('updates.downloading', { percent })}</small>
        </div>
      </div>
    );
  }
  if (info.status === 'required') {
    return (
      <div className="up-block" role="alertdialog" aria-modal="true" aria-label={t('updates.requiredTitle')}>
        <div className="up-card">{body}</div>
      </div>
    );
  }
  return <div className="up-banner" role="status" data-testid="update-banner">{body}</div>;
}
