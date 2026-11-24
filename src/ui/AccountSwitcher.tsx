import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { SAVED_EVENT, forgetAccount, rememberSession, savedAccounts, switchToAccount, type SavedAccount } from '../auth/savedAccounts';
import { LoginForm } from '../pages/Login';
import { Ic, ICON } from './fx';

const COLORS = ['#17c3c9', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#ec4899'];
const colorOf = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

function Face({ a }: { a: SavedAccount }) {
  const [broken, setBroken] = useState(false);
  if (a.avatar && !broken) return <img src={a.avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  return <span style={{ background: colorOf(a.id) }}>{a.name.slice(0, 2).toUpperCase()}</span>;
}

/** Ecrã "Quem está a usar?": as contas com sessão neste aparelho, em círculo com o nome por baixo. */
export function AccountSwitcher({ open, onClose, startAdding }: { open: boolean; onClose: () => void; startAdding?: boolean }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [list, setList] = useState<SavedAccount[]>(savedAccounts());
  const [manage, setManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const addingFrom = useRef<string | null>(null); // conta que estava ativa quando se carregou em "Adicionar conta"

  useEffect(() => {
    const on = () => setList(savedAccounts());
    window.addEventListener(SAVED_EVENT, on);
    return () => window.removeEventListener(SAVED_EVENT, on);
  }, []);
  useEffect(() => { if (open) { setList(savedAccounts()); setManage(false); setAdding(false); setError(''); if (startAdding) addAccount().catch(() => {}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  // Entrou com uma conta diferente da que estava ativa: fecha
  useEffect(() => { if (adding && auth.user && auth.user.id !== addingFrom.current) { setAdding(false); onClose(); } }, [auth.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const sb = getSupabase();
  const currentId = auth.user?.id;

  async function pick(a: SavedAccount) {
    if (manage) return;
    if (a.id === currentId) { onClose(); return; }
    if (!sb) return;
    setBusy(a.id); setError('');
    const ok = await switchToAccount(sb, a.id).catch(() => false);
    setBusy(null);
    if (ok) onClose(); else setError(t('switcher.expired', { name: a.name }));
  }
  async function addAccount() {
    if (!sb) return;
    setError('');
    // Não termina a sessão atual: terminar (mesmo só "local") anula-a no servidor e a conta deixava de poder ser escolhida.
    // A sessão fica guardada e o login da conta nova simplesmente substitui-a neste aparelho.
    const { data } = await sb.auth.getSession();
    rememberSession(data.session);
    addingFrom.current = auth.user?.id ?? null;
    setAdding(true);
  }

  return createPortal(
    <div className="sw-layer" role="dialog" aria-modal="true" aria-label={t('switcher.title')}>
      <button type="button" className="sw-close fx-round" onClick={onClose} aria-label={t('common.close')}><Ic d={ICON.close} /></button>
      {adding ? (
        <div className="sw-login">
          <LoginForm initialMode="signin" onDone={() => { setAdding(false); onClose(); }} />
          {list.length > 0 && <button type="button" className="ob-outline" onClick={() => setAdding(false)}>{t('switcher.back')}</button>}
        </div>
      ) : (
        <div className="sw-body">
          <h1>{t('switcher.title')}</h1>
          <div className="sw-list">
            {list.map((a) => (
              <div key={a.id} className={'sw-item' + (a.id === currentId ? ' on' : '')}>
                <button type="button" className="sw-face" onClick={() => pick(a)} disabled={!!busy} aria-label={a.name + (a.id === currentId ? ' · ' + t('switcher.current') : '')}>
                  <Face a={a} />
                  {busy === a.id && <i className="sw-spin" aria-hidden="true" />}
                </button>
                <b>{a.name}</b>
                <small>{a.id === currentId ? t('switcher.current') : a.email}</small>
                {manage && a.id !== currentId && (
                  <button type="button" className="sw-remove" onClick={() => forgetAccount(a.id)}>{t('switcher.remove')}</button>
                )}
              </div>
            ))}
          </div>
          {error && <p className="fx-error" role="alert">{error}</p>}
          <button type="button" className="sw-add" onClick={addAccount}>{t('switcher.add')}</button>
        </div>
      )}
    </div>,
    document.body,
  );
}
