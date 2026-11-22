import { InviteCard, type InviteInfo } from './InviteCard';
import { answerSplitInvite } from '../core/splitInvite';
import { SPLIT_CHANGED } from '../core/groupLink';
import { useEffect, useRef, useState } from 'react';
import { UserAvatar } from './UserAvatar';
import { AccountSwitcher } from './AccountSwitcher';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { getSupabase, signOut } from '../auth/supabase';
import { db } from '../db/app-db';
import { activePlan, hasFeature, loadPlan, trialDaysLeft } from '../core/plan';
import { detectSubscriptions, warrantyDaysLeft } from '../core/premium';
import { useIsAdmin } from '../pages/Admin';
import { ADMIN_LOGIN_EVENT, isUnlocked } from '../pages/AdminPhase1';
import { usePlan } from '../pages/Premium';
import { Ic } from './fx';

// Topo do Painel: conta da pessoa (foto, nome, email), campainha de notificações e menu da conta.
const BELL = 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a1.9 1.9 0 0 0 3.4 0';
const GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z';
const ITEMS = {
  settings: GEAR,
  plan: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  admin: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  backup: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  out: 'M15 4h4v16h-4M10 16l-4-4 4-4M6 12h10',
  in: 'M9 4H5v16h4M14 16l4-4-4-4M18 12H8',
  swap: 'M16 3l4 4-4 4M20 7H9M8 21l-4-4 4-4M4 17h11',
};

type Note = { id: string; text: string; to: string; kind: 'invite' | 'plan' | 'sub' | 'warranty' | 'tax'; invite?: InviteInfo };
const NOTE_IC: Record<Note['kind'], string> = {
  invite: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6', plan: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  sub: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', warranty: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4', tax: 'M7 3h10v18l-5-3-5 3zM10 8h4M10 12h4',
};

function useNotifications(): Note[] {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { const on = () => setTick((n) => n + 1); window.addEventListener(SPLIT_CHANGED, on); return () => window.removeEventListener(SPLIT_CHANGED, on); }, []);
  useEffect(() => {
    (async () => {
      const out: Note[] = [];
      const plan = loadPlan();
      const left = trialDaysLeft(plan);
      if (plan.plan === 'free' && left > 0 && left <= 3) out.push({ kind: 'plan', id: 'trial', text: t('acct.nTrial', { count: left }), to: '/plus' });
      if (hasFeature('subscriptions')) {
        const txs = (await db.transactions.toArray()).filter((x) => x.deletedAt === null);
        for (const s of detectSubscriptions(txs)) if (s.daysUntil >= 0 && s.daysUntil <= 3) out.push({ kind: 'sub', id: 'sub' + s.key, text: t('acct.nSub', { name: s.name, count: s.daysUntil }), to: '/subscricoes' });
      }
      if (hasFeature('warranties')) {
        for (const w of (await db.warranties.toArray()).filter((x) => x.deletedAt === null)) {
          const d = warrantyDaysLeft(w.purchaseDate, w.months);
          if (d >= 0 && d <= 30) out.push({ kind: 'warranty', id: 'w' + w.id, text: t('acct.nWarranty', { name: w.name, count: d }), to: '/garantias' });
        }
      }
      const m = new Date().getMonth();
      if (m <= 1) out.push({ kind: 'tax', id: 'irs', text: t('acct.nIrs'), to: '/irs' });
      // convites para grupos de divisão de contas (qualquer plano)
      const sb = getSupabase();
      if (sb && (await sb.auth.getSession()).data.session) {
        const { data } = await sb.rpc('my_split_invites');
        for (const i of (data ?? []) as Array<{ id: string; group_name: string; invited_by_name: string }>)
          out.unshift({ kind: 'invite', invite: { id: i.id, by: i.invited_by_name, group: i.group_name }, id: 'inv' + i.id, text: t('acct.nSplitInvite', { name: i.invited_by_name, group: i.group_name }), to: '/grupos' });
      }
      setNotes(out);
    })().catch(() => {});
  }, [t, tick]);
  return notes;
}

/** Campainha com o número de avisos e o painel (PC e telemóvel). */
export function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const notes = useNotifications();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const answer = async (id: string, accept: boolean) => { setBusy(id); setNoteErr(await answerSplitInvite(auth.user, id, accept)); setBusy(null); };
  const go = (to: string) => { setOpen(false); navigate(to); };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="nt" ref={ref}>
      <button type="button" className={'ab-bell' + (notes.length ? ' has' : '')} onClick={() => setOpen(!open)} aria-label={t('acct.notifications')} aria-expanded={open}>
        <Ic d={BELL} size={20} />
        {notes.length > 0 && <i className="ab-dot">{notes.length > 9 ? '9+' : notes.length}</i>}
      </button>
      {open && (
        <div className="ab-pop ab-pop-bell" role="dialog" aria-label={t('acct.notifications')}>
          <header className="nt-head"><span className="nt-bell"><Ic d={BELL} size={18} /></span><h4>{t('acct.notifications')}</h4>{notes.length > 0 && <em>{notes.length}</em>}</header>
          {noteErr && <p className="fx-error">{noteErr}</p>}
          {notes.length === 0 ? <div className="nt-empty"><span><Ic d={BELL} size={26} /></span><p>{t('acct.noNotes')}</p></div> : <div className="nt-list">{notes.map((n) => n.invite ? (
            <InviteCard key={n.id} inv={n.invite} busy={busy === n.invite.id} onAnswer={(a) => answer(n.invite!.id, a)} />
          ) : (
            <button key={n.id} type="button" className={'nt-card ' + n.kind} onClick={() => go(n.to)}><span className="nt-ic"><Ic d={NOTE_IC[n.kind]} size={18} /></span><span className="nt-body">{n.text}</span><Ic d="M9 6l6 6-6 6" size={16} /></button>
          ))}</div>}
        </div>
      )}

    </div>
  );
}

export function AccountBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const isAdmin = useIsAdmin();
  const { plan } = usePlan();
  const [open, setOpen] = useState<null | 'menu'>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const meta = (auth.user?.user_metadata ?? {}) as { name?: string; full_name?: string };
  const email = auth.user?.email ?? '';
  const name = meta.full_name || meta.name || (email ? email.split('@')[0] : t('acct.guest'));
  const masked = email ? '•••••@' + email.split('@')[1] : t('settings2.localMode');
  const [switcher, setSwitcher] = useState(false);
  const go = (to: string) => { setOpen(null); navigate(to); };
  const planName = t('plus.plan_' + activePlan());

  return (
    <div className="ab" ref={ref}>
      <AccountSwitcher open={switcher} onClose={() => setSwitcher(false)} />
      <button type="button" className="ab-chip" onClick={() => setOpen(open === 'menu' ? null : 'menu')} aria-haspopup="menu" aria-expanded={open === 'menu'}>
        <UserAvatar user={auth.user} name={name} />
        <span className="ab-who"><small className="ab-hello">{t('acct.hello')}</small><b className="ab-full">{name}</b><b className="ab-first">{name.split(' ')[0]}!</b><small className="ab-mail">{masked}</small></span>
      </button>
      <NotificationBell />

      {open === 'menu' && (
        <div className="ab-pop" role="menu">
          <div className="ab-head">
            <UserAvatar user={auth.user} name={name} />
            <div><b>{name}</b><small>{email || t('settings2.localMode')}</small></div>
            {auth.user && <span className={'ab-plan' + (plan === 'free' ? '' : ' paid')}>{planName}</span>}
          </div>
          {/* Sem conta: "Entrar ou criar conta" é a primeira opção */}
          {!auth.user && <button type="button" role="menuitem" className="ab-item accent" onClick={() => go('/definicoes')}><Ic d={ITEMS.in} />{t('acct.signIn')}</button>}
          {auth.user && <button type="button" role="menuitem" className="ab-item accent" onClick={() => go('/plus')}><Ic d={ITEMS.plan} />{plan === 'free' ? t('acct.upgrade') : t('acct.myPlan')}</button>}
          <button type="button" role="menuitem" className="ab-item" onClick={() => go('/definicoes')}><Ic d={ITEMS.backup} />{t('acct.backup')}</button>
          {isAdmin && <button type="button" role="menuitem" className="ab-item" onClick={() => { setOpen(null); if (isUnlocked()) navigate('/admin'); else window.dispatchEvent(new Event(ADMIN_LOGIN_EVENT)); }}><Ic d={ITEMS.admin} />{t('admin.title')}</button>}
          {auth.configured && auth.user && <button type="button" role="menuitem" className="ab-item" onClick={() => { setOpen(null); setSwitcher(true); }} data-testid="switch-account"><Ic d={ITEMS.swap} />{t('switcher.menu')}</button>}
          <hr />
          {auth.user && <button type="button" role="menuitem" className="ab-item danger" onClick={async () => { setOpen(null); await signOut().catch(() => {}); }}><Ic d={ITEMS.out} />{t('acct.signOut')}</button>}
        </div>
      )}
    </div>
  );
}
