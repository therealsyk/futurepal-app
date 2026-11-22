// Convites por responder: aviso num canto, com o mesmo cartão das notificações. Na página Grupos aparece sempre.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { answerSplitInvite } from '../core/splitInvite';
import { SHARE_REMOVED, SPLIT_CHANGED } from '../core/groupLink';
import { Ic } from './fx';
import { InviteCard, INVITE_IC } from './InviteCard';
import { L } from '../i18n/phrases';

type Inv = { id: string; group_name: string; invited_by_name: string };
const SEEN = 'wallet.invSeen';
const seenIds = (): string[] => { try { return JSON.parse(sessionStorage.getItem(SEEN) || '[]'); } catch { return []; } };

export function SplitInvitePopup() {
  const auth = useAuth();
  const { pathname } = useLocation();
  const groups = pathname === '/grupos';
  const [list, setList] = useState<Inv[]>([]);
  const [seen, setSeen] = useState<string[]>(seenIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !auth.user) { setList([]); return; }
    const read = () => { sb.rpc('my_split_invites').then(({ data }) => setList((data ?? []) as Inv[]), () => {}); };
    read();
    window.addEventListener(SPLIT_CHANGED, read);
    return () => window.removeEventListener(SPLIT_CHANGED, read);
  }, [auth.user, groups]);
  // apagou a sua parte nas despesas: no grupo volta a estar por pagar
  useEffect(() => {
    const on = (e: Event) => {
      const sb = getSupabase(), bill = (e as CustomEvent<string>).detail;
      if (!sb || !auth.user || !bill) return;
      Promise.resolve(sb.rpc('set_split_paid', { p_bill: bill, p_user: auth.user.id, p_paid: false })).then(() => window.dispatchEvent(new Event(SPLIT_CHANGED)), () => {});
    };
    window.addEventListener(SHARE_REMOVED, on);
    return () => window.removeEventListener(SHARE_REMOVED, on);
  }, [auth.user]);
  const show = groups ? list : list.filter((i) => !seen.includes(i.id));
  if (show.length === 0) return null;
  const answer = async (id: string, accept: boolean) => {
    setBusy(true);
    const e = await answerSplitInvite(auth.user, id, accept);
    setBusy(false); setErr(e);
    if (!e && accept) window.location.hash = '#/grupos';
  };
  const later = () => { const ids = [...new Set([...seen, ...list.map((i) => i.id)])]; setSeen(ids); try { sessionStorage.setItem(SEEN, JSON.stringify(ids)); } catch { /* sem storage */ } };
  return createPortal(
    <aside className={'nt-pop' + (groups ? ' in-groups' : '')} role="dialog" aria-label={L('Convites por responder')}>
      <header className="nt-head"><span className="nt-bell"><Ic d={INVITE_IC} size={18} /></span><h4>{L('Convites por responder')}</h4><em>{show.length}</em></header>
      {err && <p className="fx-error">{err}</p>}
      <div className="nt-list">{show.map((i) => <InviteCard key={i.id} inv={{ id: i.id, by: i.invited_by_name, group: i.group_name }} busy={busy} onAnswer={(a) => answer(i.id, a)} />)}</div>
      {!groups && <button type="button" className="spi-later" onClick={later}>{L('Decidir mais tarde')}</button>}
    </aside>,
    document.body,
  );
}
