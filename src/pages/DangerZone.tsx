import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dexie from 'dexie';
import { db, GUEST_DB, userDbName, currentDbName } from '../db/app-db';
import { deleteMyAccount, authErrorKey } from '../auth/supabase';
import { Ic, ICON } from '../ui/fx';

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
    <div className="dz">
      <p>{mode === 'account' ? t('danger.accountText') : t('danger.deviceText')}</p>
      {mode === 'account' && (
        <label className="dz-check">
          <input type="checkbox" checked={alsoDevice} onChange={(e) => setAlsoDevice(e.target.checked)} />
          <span>{t('danger.alsoDevice')}</span>
        </label>
      )}
      <label className="fx-field"><span>{t('danger.typeToConfirm', { word })}</span>
        <input className="fx-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="danger-input" />
      </label>
      {error && <p className="fx-error" role="alert">{error}</p>}
      <div className="ai-actions">
        <span style={{ flex: 1 }} />
        <button type="button" className="fx-btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="fx-btn danger" disabled={!ok || busy} onClick={run} data-testid="danger-confirm">
          <Ic d={ICON.trash} size={16} />{mode === 'account' ? t('danger.deleteAccount') : t('danger.deleteDevice')}
        </button>
      </div>
    </div>
  );
}
