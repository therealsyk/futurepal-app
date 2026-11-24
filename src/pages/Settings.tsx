import { fill } from '../ui/AccountPlan';
import { formatMoney } from '../core/money';
import { createPortal } from 'react-dom';
import { AlertPrefsPanel } from '../ui/AlertPrefs';
import { PC_MOBILE } from '../core/uiMode';
import { openTutorial } from '../ui/MobileTutorial';
import { useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode, useEffect } from 'react';
import logoUrl from '../assets/logo.svg';
import { L } from '../i18n/phrases';
import { CI_ENABLED } from '../core/ciFlag';
import { trackEvent } from '../core/presence';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Sheet, Ic, ICON, PickMenu } from '../ui/fx';
import { COUNTRIES, countryName } from '../core/locale';
import { loadSettings, saveSettings, setTheme, type AppSettings } from '../core/settings';
import { CURRENCY_CODES, currencyName } from '../core/currencies';
import { getSupabase, canSync, signOut } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { syncAll } from '../sync/syncHub';
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
import { openLogin } from '../ui/LoginWindow';

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
  sliders: 'M4 7h9M17 7h3M15 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM4 17h3M11 17h9M9 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  data: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01',
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
    <div className="st2-me st-photo" data-testid="st-user">
      <button type="button" className="st-photo-img" disabled={busy} onClick={() => ref.current?.click()} aria-label={hasOwn ? t('profile.change') : t('profile.add')} title={hasOwn ? t('profile.change') : t('profile.add')} data-testid="st-photo-change">
        <UserAvatar user={user} name={name || user.email || '?'} />
        <span className="st-photo-cam" aria-hidden="true"><Ic d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" size={13} /></span>
      </button>
      <span className="st2-who"><b>{name || user.email}</b><small>{busy ? t('profile.saving') : msg || (name ? user.email : t('settings2.signedIn'))}</small>{hasOwn && <button type="button" className="ob-link small" disabled={busy} onClick={remove}>{t('profile.remove')}</button>}</span>
      <input ref={ref} hidden type="file" accept="image/*" onChange={pick} />
    </div>
  );
}

function Row({ icon, title, sub, children, onClick, testId, cls = '' }: { icon: string; title: string; sub?: string; children?: ReactNode; onClick?: () => void; testId?: string; cls?: string }) {
  const body = (
    <>
      <span className="st-ic"><Ic d={icon} size={22} /></span>
      <span className="st-text"><b>{title}</b>{sub ? <small>{sub}</small> : null}</span>
      {children ?? (onClick ? <span className="st-chev"><Ic d={ICON.right} size={18} /></span> : null)}
    </>
  );
  return onClick
    ? <button type="button" className={'st-row' + cls} onClick={onClick} data-testid={testId}>{body}</button>
    : <div className={'st-row' + cls} data-testid={testId}>{body}</div>;
}

const TABS = ['prefs', 'alerts', 'data', 'ai', 'about'] as const;

export function Settings() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [syncMsg, setSyncMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [params, setParams] = useSearchParams();
  const [aiOpen, setAiOpen] = useState(params.get('ai') === '1');
  const [tab, setTab] = useState(() => { const x = TABS.findIndex((v) => v === (params.get('ai') ? 'ai' : params.get('tab'))); return x < 0 ? 0 : x; });
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
  const [curAsk, setCurAsk] = useState<string | null>(null), [newLogin, setNewLogin] = useState(false); // aviso ao mudar de moeda

  async function onExportBackup() {
    try {
      const data = await exportBackup(db);
      trackEvent('backup');
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
      const result = await syncAll(client, user!.id, { notifyOthers: true }); // os outros aparelhos abertos sincronizam também
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

  // Mudar de moeda não converte nada: com movimentos já registados sugere-se outra conta de login (cada moeda à parte)
  const hasMoves = async () => (await db.transactions.toArray()).some((x) => x.deletedAt === null);
  async function changeCurrency(v: string) {
    if (!v || v === settings.currency) return;
    if (await hasMoves()) { setCurAsk(v); return; }
    update({ ...settings, currency: v });
  }

  async function changeCountry(code: string) {
    const info = COUNTRIES.find((c) => c.code === code);
    const next = info ? info.currency : settings.currency, keep = next !== settings.currency && await hasMoves();
    update({ ...settings, country: code, currency: keep ? settings.currency : next, firstDayOfWeek: info?.firstDayOfWeek ?? settings.firstDayOfWeek, dateFormat: info?.dateFormat ?? settings.dateFormat });
    if (keep) setCurAsk(next); // o país muda já; a moeda só se a pessoa confirmar
  }

  function changeTheme(theme: 'dark' | 'light' | 'gray') {
    update({ ...settings, theme });
    setTheme(theme);
  }

  const currencies = CURRENCY_CODES.includes(settings.currency) ? CURRENCY_CODES : [settings.currency, ...CURRENCY_CODES];
  const aiOn = isConfigured(ai);

  return (
    <div className="fx-page st-page st2">
      <header className="st-head"><h1>{t('settings.title')}</h1></header>

      <section className="mv-card st2-hero">
        {!auth.configured ? <div className="st2-me"><img className="st2-logo" src={logoUrl} alt="" /><span className="st2-who"><b>{t('settings2.localMode')}</b><small>{t('settings.syncLocalOnly')}</small></span></div>
          : auth.user ? (
            <>
              <AccountPhotoRow />
              <div className="st2-acts">
                <button type="button" className={syncing ? 'spin' : ''} disabled={syncing} onClick={onSync} data-testid="sync-btn"><span className="lg-ic"><Ic d={I.sync} size={20} /></span><b>{t('settings.syncNow')}</b></button>
                <button type="button" onClick={() => setSwitchOpen(true)} data-testid="st-switch"><span className="lg-ic"><Ic d={I.swap} size={20} /></span><b>{t('switcher.menu')}</b></button>
                <button type="button" onClick={onSignOut} data-testid="signout-btn"><span className="lg-ic"><Ic d={I.logout} size={20} /></span><b>{t('settings2.signOut')}</b></button>
              </div>
              {syncMsg && <p className="st2-note" role="status" key={syncMsg}>{syncMsg}</p>}
            </>
          ) : (
            <><div className="st2-me"><img className="st2-logo" src={logoUrl} alt="" /><span className="st2-who"><b>{L('Guarda os teus dados')}</b><small>{L('Com conta, vês tudo no telemóvel e no computador e não perdes nada.')}</small></span></div>
              <button type="button" className="ob-cta lg-go" onClick={() => openLogin()} data-testid="st-login">{t('settings2.signInRow')}<Ic d="M5 12h14M13 6l6 6-6 6" size={18} /></button></>
          )}
      </section>

      <div className="st2-tabs" role="tablist" style={{ '--i': tab } as CSSProperties}>
        {([[I.sliders, t('settings2.preferences')], ['M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a1.9 1.9 0 0 0 3.4 0', L('Avisos')], [I.data, L('Dados')], [I.spark, t('ai.section')], [I.info, t('updates.about')]] as const).map(([d, label], i) => (
          <button key={label} type="button" role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}><Ic d={d} size={22} /><b>{label}</b></button>
        ))}
      </div>

      <div className="mv-card st2-list" key={tab} role="tabpanel">
        {tab === 1 && <AlertPrefsPanel />}
        {tab === 0 && <>
        <Row icon={I.coins} title={t('settings.currency')} sub={t('settings2.currencySub')}>
          <PickMenu label={t('settings.currency')} testId="settings-currency" value={settings.currency} options={currencies.map((c) => ({ value: c, label: `${c} · ${currencyName(c, settings.language)}` }))} onChange={(v) => { changeCurrency(String(v)).catch(() => {}); }} />
        </Row>
        <Row icon={I.globe} title={t('settings.language')} sub={t('settings2.languageSub')}>
          <PickMenu label={t('settings.language')} testId="settings-language" value={settings.language} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} onChange={(v) => changeLanguage(String(v))} />
        </Row>
        <Row icon={I.flag} title={t('settings.country')} sub={t('settings2.countrySub')}>
          <PickMenu label={t('settings.country')} testId="settings-country" value={settings.country} options={COUNTRIES.map((c) => ({ value: c.code, label: countryName(c.code, settings.language) }))} onChange={(v) => changeCountry(String(v))} />
        </Row>
        <div className="th-block">
          <Row icon={I.moon} title={t('settings.theme')}>{null}</Row>
          <div className="th-opts" role="radiogroup" aria-label={t('settings.theme')}>
            {([['dark', t('settings.themeDark')], ['gray', t('settings.themeGray')], ['light', t('settings.themeLight')]] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={settings.theme === id} className={'th-opt th-' + id + (settings.theme === id ? ' on' : '')} onClick={() => changeTheme(id)}>
                <span className="th-view" aria-hidden="true"><i /><i /><i /></span><b>{label}</b>
              </button>
            ))}
          </div>
        </div>
        {CI_ENABLED && <CiOptRow />}
        </>}
        {tab === 2 && <>
        <Row icon={I.up} title={t('settings.backupExport')} sub={t('settings2.exportSub')} onClick={onExportBackup} testId="backup-export-btn" />
        <Row icon={I.down} title={t('settings.backupImport')} sub={t('settings2.importSub')} onClick={() => importRef.current?.click()} />
        <Row icon={I.sheet} title={t('importer.title')} sub={t('importer.rowSub')} onClick={() => setImportOpen(true)} testId="import-row" />
        <Row icon={ICON.trash} title={t('danger.deleteDevice')} sub={t('danger.deviceSub')} onClick={() => setDanger('device')} testId="wipe-device" cls=" red" />
        <input ref={importRef} hidden type="file" accept="application/json" data-testid="backup-import-input" onChange={onImportBackup} />
        {backupMsg && <p className="st2-note" role="status" data-testid="backup-result">{backupMsg}</p>}
        {auth.user && <Row icon={I.user} title={t('danger.deleteAccount')} onClick={() => setDanger('account')} testId="delete-account" cls=" red" />}
        </>}
        {tab === 3 && <Row icon={I.spark} title={t('ai.rowTitle')} sub={aiOn ? `${L(getPreset(ai.provider)?.label ?? ai.provider)} · ${ai.model}` : t('ai.rowSub')} onClick={() => setAiOpen(true)} testId="ai-row" />}
        {tab === 4 && <>
        <Row icon={I.sync} title={t('updates.version', { version: APP_VERSION })} sub={updMsg || t('updates.checkSub')} onClick={updBusy ? undefined : onCheckUpdates} testId="check-updates" cls={updBusy ? ' spin' : ''} />
        {!PC_MOBILE && <Row icon="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2v.3M12 17.5h.01M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" title={L('Ver a visita guiada')} sub={L('Mostra onde está cada coisa na app')} onClick={openTutorial} />}
        <Row icon={I.chat} title={t('feedback.row')} sub={t('feedback.rowSub')} onClick={() => setFeedbackOpen(true)} testId="feedback-row" />
        <Row icon={I.sheet} title={t('settings2.licenses')} sub={t('settings2.licensesSub')} onClick={openNotices} testId="licenses" />
        </>}
      </div>

      <Sheet open={notices !== null} onClose={() => setNotices(null)} title={t('settings2.licenses')} wide>
        <pre className="st-notices">{notices}</pre>
      </Sheet>
      <Sheet open={danger !== null} onClose={() => setDanger(null)} title={danger === 'account' ? t('danger.deleteAccount') : t('danger.deleteDevice')}>
        {danger && <DangerZone mode={danger} onClose={() => { setDanger(null); update({ ...settings, account: 'none' }); }} />}
      </Sheet>
      <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <AccountSwitcher open={switchOpen} onClose={() => { setSwitchOpen(false); setNewLogin(false); }} startAdding={newLogin} />
      {curAsk && createPortal(<div className="spi-back nsv-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setCurAsk(null); }}>
        <section className="spi-card nsv-card cur-card" role="dialog" aria-modal="true" aria-label={L('Mudar de moeda')}>
          <span className="nsv-ic warn" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5M12 16h.01M12 3l9 16H3z" /></svg></span>
          <h2>{L('Já tens movimentos em')} <span className="nsv-val">{settings.currency}</span></h2>
          <div className="cur-swap" aria-hidden="true"><b>{formatMoney(5000, settings.currency, settings.language)}</b><i>→</i><b className="to">{formatMoney(5000, curAsk, settings.language)}</b></div>
          <p>{L('Mudar a moeda não converte o que já registaste: os valores ficam iguais, só muda o símbolo.')}</p>
          <p className="cur-tip">{fill(L('Para usar {c}, o melhor é criar outra conta de login. Assim cada moeda fica separada e nada se mistura.'), { c: curAsk })}</p>
          <div className="nsv-acts"><button type="button" className="gl-act" onClick={() => { update({ ...settings, currency: curAsk }); setCurAsk(null); }}>{L('Mudar na mesma')}</button>
            <button type="button" className="gl-act ok" onClick={() => { setCurAsk(null); setNewLogin(true); setSwitchOpen(true); }}>{L('Criar outra conta')}</button></div>
          <button type="button" className="cur-cancel" onClick={() => setCurAsk(null)}>{fill(L('Ficar com {c}'), { c: settings.currency })}</button>
        </section></div>, document.body)}
      <Sheet open={importOpen} onClose={() => setImportOpen(false)} title={t('importer.title')} wide>
        <ImportStatement />
      </Sheet>
      <Sheet open={aiOpen} onClose={() => { setAiOpen(false); if (params.get('ai')) setParams({}, { replace: true }); }} title={t('ai.rowTitle')} wide>
        <AiSettings onSaved={(c) => { setAi(c); }} />
      </Sheet>
    </div>
  );
}

/** Privacidade: a pessoa escolhe se os seus dados entram (agregados e anónimos) nas estatísticas do MyFuturePal. */
function CiOptRow() {
  const auth = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !auth.user) { setOn(null); return; }
    sb.from('ci_optout').select('user_id').eq('user_id', auth.user.id).maybeSingle().then(({ data, error }) => setOn(error ? null : !data), () => setOn(null));
  }, [auth.user]);
  if (on === null) return null;
  const toggle = async () => {
    const sb = getSupabase(); if (!sb || !auth.user) return;
    if (on) await sb.from('ci_optout').insert({ user_id: auth.user.id }); else await sb.from('ci_optout').delete().eq('user_id', auth.user.id);
    setOn(!on);
  };
  return (
      <div className="st-row">
        <span className="st-ic"><Ic d="M4 20V10M10 20V4M16 20v-7M22 20H2" size={22} /></span>
        <span className="st-text"><b>{L('Contribuir para estatísticas anónimas')}</b><small>{L('Os teus dados entram só em totais de 10 ou mais pessoas, nunca de forma individual.')}</small></span>
        <button type="button" role="switch" aria-checked={on} className={'ob-toggle' + (on ? ' on' : '')} onClick={toggle} aria-label={L('Contribuir para estatísticas anónimas')}><i /></button>
      </div>
  );
}
