// Aviso quando a pessoa tem duas contas principais: juntar numa só (mesmo total, sem apagar movimentos) ou não.
// Com sessão, só aparece depois de uma sincronização completa, para não avisar com dados a meio. "Não" não volta a perguntar.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db/app-db';
import { useAuth } from '../auth/AuthContext';
import { duplicateSummary, mergeDuplicateDefaults, type DuplicateSummary } from '../core/mergeAccounts';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { SYNC_DONE_EVENT, type SyncDone } from '../sync/syncHub';
import { L } from '../i18n/phrases';

const NO_KEY = 'wallet.dupMainsNo';
const keyOf = (s: DuplicateSummary) => s.accounts.map((a) => a.id).sort().join('|');

export function DuplicateAccountsPopup() {
  const auth = useAuth();
  const [dup, setDup] = useState<DuplicateSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const uid = auth.user?.id;
  useEffect(() => {
    setDup(null);
    if (!auth.ready) return;
    const check = async () => {
      const s = await duplicateSummary(db);
      let no: string | null = null;
      try { no = localStorage.getItem(NO_KEY); } catch { /* sem storage */ }
      setDup(s && no !== keyOf(s) ? s : null);
    };
    if (!uid) { const id = setTimeout(() => { check().catch(() => {}); }, 3000); return () => clearTimeout(id); }
    const on = (e: Event) => { if (!(e as CustomEvent<SyncDone>).detail?.error) check().catch(() => {}); };
    window.addEventListener(SYNC_DONE_EVENT, on);
    return () => window.removeEventListener(SYNC_DONE_EVENT, on);
  }, [uid, auth.ready]);
  if (!dup) return null;

  const lang = loadSettings().language;
  const money = (c: number) => formatMoney(c, dup.currency, lang);
  const no = () => { try { localStorage.setItem(NO_KEY, keyOf(dup)); } catch { /* sem storage */ } setDup(null); };
  const join = async () => {
    setBusy(true); setErr(false);
    try { await mergeDuplicateDefaults(db); window.location.reload(); } // as páginas abertas leem logo a conta junta
    catch { setErr(true); setBusy(false); }
  };
  return createPortal(
    <div className="spi-back">
      <div className="spi-card" role="alertdialog" aria-modal="true" aria-labelledby="dup-title">
        <span className="spi-face dup-ic" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l10 18H2zM12 10v5M12 18h.01" /></svg></span>
        <p className="spi-text" id="dup-title"><b>{L('Tens 2 contas principais')}</b></p>
        <div className="dup-list">
          {dup.accounts.map((a) => <p key={a.id}><span>{a.name}</span><b className={a.cents < 0 ? 'fx-neg' : ''}>{money(a.cents)}</b></p>)}
          <p className="dup-total"><span>{L('Total')}</span><b>{money(dup.total)}</b></p>
        </div>
        <p className="dup-text">{L('Queres uni-las numa só? O saldo total mantém-se e nenhum movimento é apagado.')}</p>
        {err && <p className="spi-warn">{L('Não foi possível juntar sem mudar o saldo. Nada foi alterado.')}</p>}
        <div className="spi-btns">
          <button type="button" className="spi-btn danger" disabled={busy} onClick={no}>{L('Não')}</button>
          <button type="button" className="spi-btn yes" disabled={busy} onClick={join}>{busy ? '…' : L('Juntar contas')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
