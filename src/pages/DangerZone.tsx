import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dexie from 'dexie';
import { db, GUEST_DB, userDbName, currentDbName } from '../db/app-db';
import { deleteMyAccount, authErrorKey } from '../auth/supabase';
import { Ic, ICON } from '../ui/fx';
import { SwitchRow } from '../ui/formFields';

// "Apagar conta" (exigido pelas lojas) e "Apagar dados deste aparelho". Ambos pedem confirmação escrita.

/** Apaga TODOS os dados deste aparelho (sem conta e de todas as contas que entraram aqui) e recomeça a app. */
export async function wipeThisDevice(): Promise<void> {
  let known: string[] = [];
  try { known = JSON.parse(localStorage.getItem('wallet.knownAccounts') || '[]'); } catch { /* sem storage */ }
  db.close();
  for (const name of [GUEST_DB, ...known.map(userDbName)]) await Dexie.delete(name);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('wallet.') || k.startsWith('sb-')) localStorage.removeItem(k);
    sessionStorage.clear();
  } catch { /* sem storage */ }
  window.location.hash = '#/';
  window.location.reload();
}

/** Depois de apagar a conta: apaga também a cópia local dessa conta neste aparelho. */
async function forgetAccountLocally(): Promise<void> {
  const name = currentDbName();
  if (name === GUEST_DB) return;
  db.close();
  await Dexie.delete(name);
  try {
    const id = name.replace(/^wallet-u-/, '');
    const known: string[] = JSON.parse(localStorage.getItem('wallet.knownAccounts') || '[]');
    localStorage.setItem('wallet.knownAccounts', JSON.stringify(known.filter((k) => k !== id)));
  } catch { /* sem storage */ }
}

export function DangerZone({ mode, onClose }: { mode: 'account' | 'device'; onClose: () => void }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [alsoDevice, setAlsoDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const word = t('danger.confirmWord');
  const ok = typed.trim().toUpperCase() === word.toUpperCase();

  async function run() {
    setBusy(true); setError('');
    try {
      if (mode === 'account') {
        await deleteMyAccount();
        if (alsoDevice) { await wipeThisDevice(); return; }
        await forgetAccountLocally();
        window.location.hash = '#/';
        window.location.reload(); // volta à app sem conta
      } else {
        await wipeThisDevice();
      }
    } catch (err) {
      setError(t(authErrorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acc-form dzx">
      <span className="dzx-ic"><Ic d={ICON.trash} size={34} /></span>
      <p>{mode === 'account' ? t('danger.accountText') : t('danger.deviceText')}</p>
      {mode === 'account' && <div className="tx-rows"><SwitchRow icon="M5 4h14v12H5zM9 20h6M12 16v4" label={t('danger.alsoDevice')} on={alsoDevice} onChange={setAlsoDevice} /></div>}
      <div className="mv-card lg-card"><label className="lg-f"><span className="lg-ic"><Ic d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" size={20} /></span><span className="lg-in"><small>{t('danger.typeToConfirm', { word })}</small><input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={word} data-testid="danger-input" /></span></label></div>
      {error && <p className="ob-error lg-msg" role="alert">{error}</p>}
      <button type="button" className="dzx-go" disabled={!ok || busy} onClick={run} data-testid="danger-confirm"><Ic d={ICON.trash} size={18} />{mode === 'account' ? t('danger.deleteAccount') : t('danger.deleteDevice')}</button>
      <button type="button" className="on-skip" onClick={onClose}>{t('common.cancel')}</button>
    </div>
  );
}
