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
import { buildAlerts, dismissNote, loadAlertPrefs, loadNoteState, markRead, NOTES_EVENT, visibleNote, type PlanAlert } from '../core/planningAlerts';
import { loadPlanInput } from '../core/planningData';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { useTxSaved } from './TxForm';
import { L } from '../i18n/phrases';
import { catLabel } from './fx';
import { openLogin } from './LoginWindow';

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

type Note = { id: string; text: string; to: string; kind: 'invite' | 'plan' | 'sub' | 'warranty' | 'tax' | 'alert'; invite?: InviteInfo; alert?: PlanAlert };
const NOTE_IC: Record<Note['kind'], string> = {
  invite: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6', plan: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  sub: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', warranty: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4', tax: 'M7 3h10v18l-5-3-5 3zM10 8h4M10 12h4', alert: 'M3 17l6-6 4 4 8-8M14 7h7v7',
};
const ALERT_IC: Record<PlanAlert['kind'], string> = {
  planning: 'M3 17l6-6 4 4 8-8M14 7h7v7', lowBalance: 'M12 8v5M12 16h.01M12 3l9 16H3z', payment: 'M5 5h14v15H5zM5 10h14M8 3v4M16 3v4', annual: 'M5 5h14v15H5zM5 10h14M8 3v4M16 3v4M12 14v3',
  budget: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z', goal: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8', debt: 'M3 10l9-6 9 6M5 10v9h14v-9', groups: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
};
const fillT = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
/** Texto de um aviso, na língua da pessoa. Avisos são "a rever", nunca acusações. */
function alertText(a: PlanAlert): string {
  const st = loadSettings(), money = (c: number) => formatMoney(c, st.currency, st.language);
  const day = (iso?: string) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString(st.language, { day: 'numeric', month: 'short' }) : '');
  const p = a.p, when = p.days === 0 ? L('hoje') : p.days === 1 ? L('amanhã') : fillT(L('em {n} dias'), { n: String(p.days ?? 0) });
  switch (a.id.split(':')[0]) {
    case 'low': return fillT(L('Previsão: o saldo pode ficar em {v} a {d}.'), { v: money(p.cents ?? 0), d: day(p.date) });
    case 'pay': return fillT(L('{n}: {v} {w}.'), { n: p.name || L('Pagamento'), v: money(p.cents ?? 0), w: when }) + (p.ratio ? ' ' + fillT(L('Se cancelares, poupas {y} por ano.'), { y: money(p.ratio) }) : '');
    case 'annual': return fillT(L('Despesa anual: {n} ({v}) {w}.'), { n: p.name ?? '', v: money(p.cents ?? 0), w: when });
    case 'budget': return fillT(L('Limite de {n}: já usaste {r}%.'), { n: p.name ?? '', r: String(Math.round((p.ratio ?? 0) * 100)) });
    case 'budgetFc': return fillT(L('Ao ritmo atual, {n} pode passar o limite este mês.'), { n: p.name ?? '' });
    case 'goalDone': return fillT(L('Meta concluída: {n} 🎉'), { n: p.name ?? '' });
    case 'goalDue': return fillT(L('A data da meta {n} é {w}. Faltam {v}.'), { n: p.name ?? '', w: when, v: money(p.cents ?? 0) });
    case 'debtDone': return fillT(L('Dívida concluída: {n} 🎉'), { n: p.name ?? '' });
    case 'debtEnd': return fillT(L('{n}: está prevista a última prestação.'), { n: p.name ?? '' });
    case 'plan': return fillT(L('Novo mês! Já podes planear {m}: vê se as tuas despesas e metas cabem.'), { m: p.date ? new Date(p.date + 'T12:00:00').toLocaleDateString(st.language, { month: 'long' }) : '' });
    case 'grpOwe': return fillT(L('Tens {v} por pagar em grupos partilhados.'), { v: money(p.cents ?? 0) });
    default: return '';
  }
}

function useNotifications(): Note[] {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    for (const ev of [SPLIT_CHANGED, NOTES_EVENT, 'wallet:db-changed']) window.addEventListener(ev, on);
    return () => { for (const ev of [SPLIT_CHANGED, NOTES_EVENT, 'wallet:db-changed']) window.removeEventListener(ev, on); };
  }, []);
  useTxSaved(() => setTick((n) => n + 1));
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
      // avisos do Planeamento (mesma projeção; id fixo por acontecimento)
      try {
        const inp = await loadPlanInput(db);
        const cats = await db.categories.toArray();
        for (const a of buildAlerts(inp, loadAlertPrefs(), (id) => { const c = cats.find((x) => x.id === id); return c ? catLabel(t, c) : ''; }, (id) => cats.find((x) => x.id === id)?.nameKey ?? '')) out.push({ kind: 'alert', id: a.id, alert: a, text: alertText(a), to: a.to });
      } catch { /* sem dados: sem avisos */ }
      const st = loadNoteState(), today = new Date().toLocaleDateString('sv-SE');
      setNotes(out.filter((n) => visibleNote(n.id, st, today))); // lidas ficam (sem aura) até limpar
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
  const st = loadNoteState();
  const unread = notes.filter((n) => !st.read[n.id]).length;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const answer = async (id: string, accept: boolean) => { setBusy(id); setNoteErr(await answerSplitInvite(auth.user, id, accept)); setBusy(null); };
  const go = (to: string, id?: string) => { if (id) markRead([id]); setOpen(false); navigate(to); };
  // só uma janela de cada vez: abrir as notificações fecha o menu da conta, e vice-versa
  useEffect(() => { if (open) window.dispatchEvent(new CustomEvent('wallet:pop', { detail: 'bell' })); }, [open]);
  useEffect(() => { const on = (e: Event) => { if ((e as CustomEvent).detail !== 'bell') setOpen(false); }; window.addEventListener('wallet:pop', on); return () => window.removeEventListener('wallet:pop', on); }, []);
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
      <button type="button" className={'ab-bell' + (unread ? ' has' : '')} onClick={() => setOpen(!open)} aria-label={t('acct.notifications')} aria-expanded={open}>
        <Ic d={BELL} size={20} />
        {unread > 0 && <i className="ab-dot">{unread > 9 ? '9+' : unread}</i>}
      </button>
      {open && (
        <div className="ab-pop ab-pop-bell" role="dialog" aria-label={t('acct.notifications')}>
          <header className="nt-head"><span className="nt-bell"><Ic d={BELL} size={18} /></span><h4>{t('acct.notifications')}</h4>{unread > 0 && <em>{unread}</em>}
            <span className="nt-acts">{unread > 0 && <button type="button" onClick={() => markRead(notes.map((n) => n.id))}>{L('Marcar todas como lidas')}</button>}
</span></header>
          {noteErr && <p className="fx-error">{noteErr}</p>}
          {notes.length === 0 ? <div className="nt-empty"><span><Ic d={BELL} size={26} /></span><p>{t('acct.noNotes')}</p></div> : <div className="nt-list">{notes.map((n) => n.invite ? (
            <InviteCard key={n.id} inv={n.invite} busy={busy === n.invite.id} onAnswer={(a) => answer(n.invite!.id, a)} />
          ) : (
            <div key={n.id} className={'nt-item' + (st.read[n.id] ? ' read' : ' unread')}>
              <button type="button" className={'nt-card ' + n.kind + (n.alert ? ' p' + n.alert.priority : '')} onClick={() => go(n.to, n.id)}><span className="nt-ic"><Ic d={n.alert ? ALERT_IC[n.alert.kind] : NOTE_IC[n.kind]} size={18} /></span><span className="nt-body">{n.text}</span><Ic d="M9 6l6 6-6 6" size={16} /></button>
            </div>
          ))}</div>}
          {notes.some((n) => !n.invite) && <button type="button" className="nt-clear" onClick={() => notes.filter((n) => !n.invite).forEach((n) => dismissNote(n.id))}><Ic d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" size={16} />{L('Limpar notificações')}</button>}
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
  useEffect(() => { if (open) window.dispatchEvent(new CustomEvent('wallet:pop', { detail: 'acct' })); }, [open]);
  useEffect(() => { const on = (e: Event) => { if ((e as CustomEvent).detail !== 'acct') setOpen(null); }; window.addEventListener('wallet:pop', on); return () => window.removeEventListener('wallet:pop', on); }, []);
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
          {!auth.user && <button type="button" role="menuitem" className="ab-item accent" onClick={() => { setOpen(null); openLogin(); }}><Ic d={ITEMS.in} />{t('acct.signIn')}</button>}
          {auth.user && <button type="button" role="menuitem" className="ab-item accent" onClick={() => go('/plus')}><Ic d={ITEMS.plan} />{plan === 'free' ? t('acct.upgrade') : t('acct.myPlan')}</button>}
          <button type="button" role="menuitem" className="ab-item" onClick={() => go('/definicoes?tab=data')}><Ic d={ITEMS.backup} />{t('acct.backup')}</button>
          {isAdmin && <button type="button" role="menuitem" className="ab-item" onClick={() => { setOpen(null); if (isUnlocked()) navigate('/admin'); else window.dispatchEvent(new Event(ADMIN_LOGIN_EVENT)); }}><Ic d={ITEMS.admin} />{t('admin.title')}</button>}
          {auth.configured && auth.user && <button type="button" role="menuitem" className="ab-item" onClick={() => { setOpen(null); setSwitcher(true); }} data-testid="switch-account"><Ic d={ITEMS.swap} />{t('switcher.menu')}</button>}
          <hr />
          {auth.user && <button type="button" role="menuitem" className="ab-item danger" onClick={async () => { setOpen(null); await signOut().catch(() => {}); }}><Ic d={ITEMS.out} />{t('acct.signOut')}</button>}
        </div>
      )}
    </div>
  );
}
