import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { signOut } from '../auth/supabase';
import { db } from '../db/app-db';
import { activePlan, hasFeature, loadPlan, trialDaysLeft } from '../core/plan';
import { detectSubscriptions, warrantyDaysLeft } from '../core/premium';
import { useIsAdmin } from '../pages/Admin';
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
};

type Note = { id: string; text: string; to: string };

function useNotifications(): Note[] {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    (async () => {
      const out: Note[] = [];
      const plan = loadPlan();
      const left = trialDaysLeft(plan);
      if (plan.plan === 'free' && left > 0 && left <= 3) out.push({ id: 'trial', text: t('acct.nTrial', { count: left }), to: '/plus' });
      if (hasFeature('subscriptions')) {
        const txs = (await db.transactions.toArray()).filter((x) => x.deletedAt === null);
        for (const s of detectSubscriptions(txs)) if (s.daysUntil >= 0 && s.daysUntil <= 3) out.push({ id: 'sub' + s.key, text: t('acct.nSub', { name: s.name, count: s.daysUntil }), to: '/subscricoes' });
      }
      if (hasFeature('warranties')) {
        for (const w of (await db.warranties.toArray()).filter((x) => x.deletedAt === null)) {
          const d = warrantyDaysLeft(w.purchaseDate, w.months);
          if (d >= 0 && d <= 30) out.push({ id: 'w' + w.id, text: t('acct.nWarranty', { name: w.name, count: d }), to: '/garantias' });
        }
      }
      const m = new Date().getMonth();
      if (m <= 1) out.push({ id: 'irs', text: t('acct.nIrs'), to: '/irs' });
      setNotes(out);
    })().catch(() => {});
  }, [t]);
  return notes;
}

export function AccountBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const isAdmin = useIsAdmin();
  const { plan } = usePlan();
  const notes = useNotifications();
  const [open, setOpen] = useState<null | 'menu' | 'bell'>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const meta = (auth.user?.user_metadata ?? {}) as { name?: string; full_name?: string; avatar_url?: string; picture?: string };
  const email = auth.user?.email ?? '';
  const name = meta.full_name || meta.name || (email ? email.split('@')[0] : t('acct.guest'));
  const photo = meta.avatar_url || meta.picture;
  const masked = email ? '•••••@' + email.split('@')[1] : t('settings2.localMode');
  const go = (to: string) => { setOpen(null); navigate(to); };
  const planName = t('plus.plan_' + activePlan());

  return (
    <div className="ab" ref={ref}>
      <button type="button" className="ab-chip" onClick={() => setOpen(open === 'menu' ? null : 'menu')} aria-haspopup="menu" aria-expanded={open === 'menu'}>
        {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : <span className="ab-initials">{name.slice(0, 2).toUpperCase()}</span>}
        <span className="ab-who"><b>{name}</b><small>{masked}</small></span>
        <Ic d={GEAR} size={18} />
      </button>
      <button type="button" className="ab-bell" onClick={() => setOpen(open === 'bell' ? null : 'bell')} aria-label={t('acct.notifications')} aria-expanded={open === 'bell'}>
        <Ic d={BELL} size={20} />
        {notes.length > 0 && <i className="ab-dot" />}
      </button>

      {open === 'bell' && (
        <div className="ab-pop ab-pop-bell" role="dialog" aria-label={t('acct.notifications')}>
          <h4>{t('acct.notifications')}</h4>
          {notes.length === 0 ? <p className="fx-muted">{t('acct.noNotes')}</p> : notes.map((n) => (
            <button key={n.id} type="button" className="ab-note" onClick={() => go(n.to)}>{n.text}</button>
          ))}
        </div>
      )}

      {open === 'menu' && (
        <div className="ab-pop" role="menu">
          <div className="ab-head">
            {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : <span className="ab-initials">{name.slice(0, 2).toUpperCase()}</span>}
            <div><b>{name}</b><small>{email || t('settings2.localMode')}</small></div>
            <span className={'ab-plan' + (plan === 'free' ? '' : ' paid')}>{planName}</span>
          </div>
          <button type="button" role="menuitem" className="ab-item accent" onClick={() => go('/plus')}><Ic d={ITEMS.plan} />{plan === 'free' ? t('acct.upgrade') : t('acct.myPlan')}</button>
          <button type="button" role="menuitem" className="ab-item" onClick={() => go('/definicoes')}><Ic d={ITEMS.settings} />{t('nav.settings')}</button>
          <button type="button" role="menuitem" className="ab-item" onClick={() => go('/definicoes')}><Ic d={ITEMS.backup} />{t('acct.backup')}</button>
          {isAdmin && <button type="button" role="menuitem" className="ab-item" onClick={() => go('/admin')}><Ic d={ITEMS.admin} />{t('admin.title')}</button>}
          <hr />
          {auth.user
            ? <button type="button" role="menuitem" className="ab-item danger" onClick={async () => { setOpen(null); await signOut().catch(() => {}); }}><Ic d={ITEMS.out} />{t('acct.signOut')}</button>
            : <button type="button" role="menuitem" className="ab-item" onClick={() => go('/definicoes')}><Ic d={ITEMS.in} />{t('acct.signIn')}</button>}
        </div>
      )}
    </div>
  );
}
