import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Seg, Sheet, Ic, ICON } from '../ui/fx';
import { COUNTRIES, countryName } from '../core/locale';
import { loadSettings, saveSettings, setTheme, type AppSettings } from '../core/settings';
import { CURRENCY_CODES, currencyName } from '../core/currencies';
import { getSupabase, canSync, signOut } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { LoginForm } from './Login';
import { runSync } from '../sync/runSync';
import { db } from '../db/app-db';
import { exportBackup, importBackup, type BackupData } from '../core/backup';
import { AiSettings } from './AiSettings';
import { ImportStatement } from './ImportStatement';
import { DangerZone } from './DangerZone';
import { loadAiConfig, isConfigured, getPreset } from '../core/ai';
import { todayISO } from '../core/dates';
import { APP_VERSION } from '../core/version';
import { fullCheck, UPDATE_CHECK_EVENT } from '../ui/UpdateNotice';
import { UserAvatar } from '../ui/UserAvatar';
import { removeAvatar, saveAvatar } from '../core/avatar';
import { FeedbackSheet } from './Feedback';
import { AccountSwitcher } from '../ui/AccountSwitcher';

const LANGUAGES = [
  { code: 'pt-PT', label: 'Português (Portugal)' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

const I = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  sync: 'M20 11a8 8 0 0 0-14.9-3M4 5v3h3M4 13a8 8 0 0 0 14.9 3M20 19v-3h-3',
  coins: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  spark: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  up: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  down: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  sheet: 'M4 4h16v16H4zM4 9h16M4 14h16M10 4v16',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11',
  chat: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  swap: 'M16 3l4 4-4 4M20 7H9M8 21l-4-4 4-4M4 17h11',
};

// Linha da conta com a foto de perfil (só com sessão): tocar na foto escolhe outra; "Remover" volta à do Google / iniciais.
function AccountPhotoRow() {
  const { t } = useTranslation();
  const auth = useAuth();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!auth.user) return null;
  const user = auth.user;
  const meta = (user.user_metadata ?? {}) as { name?: string; full_name?: string; avatar_custom?: string | null };
  const name = meta.full_name || meta.name || '';
  const hasOwn = Boolean(meta.avatar_custom);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { setMsg(t('profile.notImage')); return; }
    setBusy(true); setMsg('');
    try { await saveAvatar(f, getSupabase(), user); setMsg(t('profile.savedCloud')); } catch { setMsg(t('profile.error')); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMsg('');
    try { await removeAvatar(getSupabase(), user); } catch { setMsg(t('profile.error')); } finally { setBusy(false); }
  }

  return (
    <div className="st-row st-photo" data-testid="st-user">
      <button type="button" className="st-photo-img" disabled={busy} onClick={() => ref.current?.click()} aria-label={hasOwn ? t('profile.change') : t('profile.add')} title={hasOwn ? t('profile.change') : t('profile.add')} data-testid="st-photo-change">
        <UserAvatar user={user} name={name || user.email || '?'} />
        <span className="st-photo-cam" aria-hidden="true"><Ic d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" size={12} /></span>
      </button>
      <span className="st-text"><b>{name || user.email}</b><small>{busy ? t('profile.saving') : msg || (name ? user.email : t('settings2.signedIn'))}</small></span>
      {hasOwn && <button type="button" className="fx-btn" disabled={busy} onClick={remove}>{t('profile.remove')}</button>}
      <input ref={ref} hidden type="file" accept="image/*" onChange={pick} />
    </div>
  );
}

function Row({ icon, title, sub, children, onClick, testId }: { icon: string; title: string; sub?: string; children?: ReactNode; onClick?: () => void; testId?: string }) {
  const body = (
    <>
      <span className="st-ic"><Ic d={icon} size={22} /></span>
      <span className="st-text"><b>{title}</b>{sub ? <small>{sub}</small> : null}</span>
      {children ?? (onClick ? <span className="st-chev"><Ic d={ICON.right} size={18} /></span> : null)}
    </>
  );
  return onClick
    ? <button type="button" className="st-row" onClick={onClick} data-testid={testId}>{body}</button>
    : <div className="st-row" data-testid={testId}>{body}</div>;
}

export function Settings() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [syncMsg, setSyncMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const [aiOpen, setAiOpen] = useState(params.get('ai') === '1');
  const [importOpen, setImportOpen] = useState(false);
  const [danger, setDanger] = useState<'account' | 'device' | null>(null);
  const [notices, setNotices] = useState<string | null>(null);
  async function openNotices() {
    try { setNotices(await (await fetch('./THIRD_PARTY_NOTICES.txt')).text()); } catch { setNotices(t('updates.unknown')); }
  }
  const [ai, setAi] = useState(loadAiConfig());
  const [updMsg, setUpdMsg] = useState('');
  const [updBusy, setUpdBusy] = useState(false);
  async function onCheckUpdates() {
    setUpdBusy(true); setUpdMsg(t('updates.checking'));
    try {
      const r = await fullCheck();
      if (r.status === 'available' || r.status === 'required') {
        setUpdMsg(t('updates.availableTitle', { version: r.latest }));
        window.dispatchEvent(new Event(UPDATE_CHECK_EVENT)); // mostra o aviso mesmo que tenha sido adiado
      } else {
        setUpdMsg(r.status === 'current' ? t('updates.upToDate') : t('updates.unknown'));
      }
    } finally {
      setUpdBusy(false);
    }
  }
  const importRef = useRef<HTMLInputElement>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  async function onExportBackup() {
    try {
      const data = await exportBackup(db);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallet-backup-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg(t('settings.backupExported'));
    } catch (err) {
      setBackupMsg(t('settings.backupError', { error: String(err) }));
    }
  }

  async function onImportBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as BackupData;
      const count = await importBackup(db, data);
      setBackupMsg(t('settings.backupImported', { count }));
    } catch (err) {
      setBackupMsg(t('settings.backupError', { error: String(err) }));
    } finally {
      e.target.value = '';
    }
  }

  async function onSync() {
    setSyncMsg('');
    const client = getSupabase();
    const user = auth.user;
    if (!client || !canSync(user)) { setSyncMsg(t('settings.syncNoUser')); return; }
    setSyncing(true);
    try {
      const result = await runSync(client, db, user!.id);
      if (result.settings) setSettings(result.settings);
      setSyncMsg(result.error ? t('settings.syncError', { error: result.error }) : t('settings.syncSuccess', { pushed: result.pushed, pulled: result.pulled }));
    } finally {
      setSyncing(false);
    }
  }

  async function onSignOut() {
    await signOut();
    update({ ...settings, account: 'none' });
    setSyncMsg('');
  }

  function update(next: AppSettings) {
    setSettings(next);
    saveSettings(next);
  }

  function changeLanguage(code: string) {
    update({ ...settings, language: code });
    i18n.changeLanguage(code);
  }

  function changeCountry(code: string) {
    const info = COUNTRIES.find((c) => c.code === code);
    update({ ...settings, country: code, currency: info ? info.currency : settings.currency, firstDayOfWeek: info?.firstDayOfWeek ?? settings.firstDayOfWeek, dateFormat: info?.dateFormat ?? settings.dateFormat });
  }

  function changeTheme(theme: 'dark' | 'light' | 'gray') {
    update({ ...settings, theme });
    setTheme(theme);
  }

  const currencies = CURRENCY_CODES.includes(settings.currency) ? CURRENCY_CODES : [settings.currency, ...CURRENCY_CODES];
  const aiOn = isConfigured(ai);

  return (
    <div className="fx-page st-page">
      <header className="st-head"><h1>{t('settings.title')}</h1></header>

      <h2 className="st-section">{t('settings2.account')}</h2>
      <div className="st-group">
        {!auth.configured ? (
          <Row icon={I.user} title={t('settings2.localMode')} sub={t('settings.syncLocalOnly')} />
        ) : auth.user ? (
          <>
            <AccountPhotoRow />
            <Row icon={I.swap} title={t('switcher.menu')} sub={t('switcher.rowSub')} onClick={() => setSwitchOpen(true)} testId="st-switch" />
            <Row icon={I.sync} title={t('settings.syncNow')} sub={syncMsg || t('settings.syncReady')} onClick={syncing ? undefined : onSync} testId="sync-btn" />
          </>
        ) : (
          <Row icon={I.user} title={t('settings2.signInRow')} sub={t('settings2.signInRowSub')} onClick={() => setLoginOpen(true)} testId="st-login" />
        )}
      </div>

      <h2 className="st-section">{t('settings2.preferences')}</h2>
      <div className="st-group">
        <Row icon={I.coins} title={t('settings.currency')} sub={t('settings2.currencySub')}>
          <select className="st-pill" value={settings.currency} onChange={(e) => update({ ...settings, currency: e.target.value })} aria-label={t('settings.currency')} id="settings-currency">
            {currencies.map((c) => <option key={c} value={c}>{c} · {currencyName(c, settings.language)}</option>)}
          </select>
        </Row>
        <Row icon={I.globe} title={t('settings.language')} sub={t('settings2.languageSub')}>
          <select className="st-pill" value={settings.language} onChange={(e) => changeLanguage(e.target.value)} aria-label={t('settings.language')} id="settings-language">
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Row>
        <Row icon={I.flag} title={t('settings.country')} sub={t('settings2.countrySub')}>
          <select className="st-pill" value={settings.country} onChange={(e) => changeCountry(e.target.value)} aria-label={t('settings.country')} id="settings-country">
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{countryName(c.code, settings.language)}</option>)}
          </select>
        </Row>
        <Row icon={I.moon} title={t('settings.theme')}>
          <Seg<'dark' | 'gray' | 'light'> value={settings.theme} onChange={changeTheme} label={t('settings.theme')}
            options={[{ id: 'dark', label: t('settings.themeDark') }, { id: 'gray', label: t('settings.themeGray') }, { id: 'light', label: t('settings.themeLight') }]} />
        </Row>
      </div>

      <h2 className="st-section">{t('ai.section')}</h2>
      <div className="st-group">
        <Row icon={I.spark} title={t('ai.rowTitle')} sub={aiOn ? `${getPreset(ai.provider)?.label ?? ai.provider} · ${ai.model}` : t('ai.rowSub')} onClick={() => setAiOpen(true)} testId="ai-row" />
      </div>

      <h2 className="st-section">{t('updates.about')}</h2>
      <div className="st-group">
        <Row icon={I.sync} title={t('updates.version', { version: APP_VERSION })} sub={updMsg || t('updates.checkSub')} onClick={updBusy ? undefined : onCheckUpdates} testId="check-updates" />
        <Row icon={I.chat} title={t('feedback.row')} sub={t('feedback.rowSub')} onClick={() => setFeedbackOpen(true)} testId="feedback-row" />
        <Row icon={I.sheet} title={t('settings2.licenses')} sub={t('settings2.licensesSub')} onClick={openNotices} testId="licenses" />
      </div>

      <h2 className="st-section">{t('settings2.data')}</h2>
      <div className="st-group">
        <Row icon={I.up} title={t('settings.backupExport')} sub={t('settings2.exportSub')} onClick={onExportBackup} testId="backup-export-btn" />
        <Row icon={I.down} title={t('settings.backupImport')} sub={t('settings2.importSub')} onClick={() => importRef.current?.click()} />
        <Row icon={I.sheet} title={t('importer.title')} sub={t('importer.rowSub')} onClick={() => setImportOpen(true)} testId="import-row" />
        <Row icon={ICON.trash} title={t('danger.deleteDevice')} sub={t('danger.deviceSub')} onClick={() => setDanger('device')} testId="wipe-device" />
        <input ref={importRef} hidden type="file" accept="application/json" data-testid="backup-import-input" onChange={onImportBackup} />
      </div>
      {backupMsg && <p className="st-msg" data-testid="backup-result">{backupMsg}</p>}

      {auth.user && (
        <>
          <button type="button" className="st-signout" onClick={onSignOut} data-testid="signout-btn"><Ic d={I.logout} size={18} />{t('settings2.signOut')}</button>
          <button type="button" className="st-danger-link" onClick={() => setDanger('account')} data-testid="delete-account">{t('danger.deleteAccount')}</button>
        </>
      )}

      <Sheet open={loginOpen} onClose={() => setLoginOpen(false)} title={t('settings2.signInRow')}>
        <LoginForm onDone={() => { setLoginOpen(false); update({ ...settings, account: 'signedin' }); }} />
      </Sheet>
      <Sheet open={notices !== null} onClose={() => setNotices(null)} title={t('settings2.licenses')} wide>
        <pre className="st-notices">{notices}</pre>
      </Sheet>
      <Sheet open={danger !== null} onClose={() => setDanger(null)} title={danger === 'account' ? t('danger.deleteAccount') : t('danger.deleteDevice')}>
        {danger && <DangerZone mode={danger} onClose={() => { setDanger(null); update({ ...settings, account: 'none' }); }} />}
      </Sheet>
      <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <AccountSwitcher open={switchOpen} onClose={() => setSwitchOpen(false)} />
      <Sheet open={importOpen} onClose={() => setImportOpen(false)} title={t('importer.title')} wide>
        <ImportStatement />
      </Sheet>
      <Sheet open={aiOpen} onClose={() => { setAiOpen(false); if (params.get('ai')) setParams({}, { replace: true }); }} title={t('ai.rowTitle')} wide>
        <AiSettings onSaved={(c) => { setAi(c); }} />
      </Sheet>
    </div>
  );
}
