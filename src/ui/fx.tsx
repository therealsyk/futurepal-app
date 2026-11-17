import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account } from '../db/database';
import {
  ALL_ACCOUNTS, getActiveAccountId, setActiveAccountId, listAccounts, ensureDefaultAccount,
} from '../core/accounts';
import { loadSettings } from '../core/settings';

// Peças partilhadas pelas páginas (mesmo visual do Painel).

export const ICON = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16 14.5h.01',
  piggy: 'M5 11a7 6 0 0 1 12-3h3v4l-2 1v3h-3l-1-1h-3l-1 1H7v-3a5 5 0 0 1-2-2zM15 11h.01',
  debt: 'M12 3v18M16.5 7.5C15.5 6.5 14 6 12 6c-2.5 0-4 1.1-4 2.8 0 4 8.5 1.8 8.5 6 0 1.7-1.7 3.2-4.5 3.2-2 0-3.7-.7-4.8-1.8',
  target: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM12 12h.01',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4',
  check: 'M5 12l5 5 9-10',
  repeat: 'M4 9h13l-3-3M20 15H7l3 3',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
};

// Nome de uma categoria: chave i18n (catHome → categories.catHome) ou nome próprio.
export function catLabel(t: (k: string) => string, c: { name: string; nameKey?: string }): string {
  if (!c.nameKey) return c.name;
  const key = c.nameKey.includes('.') ? c.nameKey : 'categories.' + c.nameKey;
  const v = t(key);
  return v === key ? c.name : v;
}

export function Ic({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="fx-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="fx-head-actions">{children}</div> : null}
    </header>
  );
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="fx-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="fx-toggle-row">
      <div>
        <b>{label}</b>
        {hint ? <span>{hint}</span> : null}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={'fx-toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
        <i />
      </button>
    </div>
  );
}

export function MonthNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fx-monthnav">
      <button type="button" className="fx-round" onClick={onPrev} aria-label={t('calendar.prevMonth')}><Ic d={ICON.left} /></button>
      <span>{label}</span>
      <button type="button" className="fx-round" onClick={onNext} aria-label={t('calendar.nextMonth')}><Ic d={ICON.right} /></button>
    </div>
  );
}

// Janela modal centrada (no telemóvel seria uma folha por baixo).
export function Sheet({ title, open, onClose, children, footer, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  // Portal para o <body>: a animação de .fx-page usa transform, o que prenderia o position:fixed à página.
  return createPortal(
    <div className="fx-backdrop" onMouseDown={onClose}>
      <div className={'fx-sheet' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="fx-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="fx-round" onClick={onClose} aria-label={t('common.close')}><Ic d={ICON.close} /></button>
        </div>
        <div className="fx-sheet-body">{children}</div>
        {footer ? <div className="fx-sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="fx-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function EmptyState({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="fx-emptystate">
      <div className="fx-emptyic"><Ic d={icon} size={26} /></div>
      <h3>{title}</h3>
      {sub ? <p>{sub}</p> : null}
      {action}
    </div>
  );
}

// Carrega as contas e a conta ativa (guardada entre sessões).
export function useAccounts() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActiveState] = useState<string>(getActiveAccountId());
  const refresh = async () => {
    const s = loadSettings();
    await ensureDefaultAccount(db, s.currency, t('accounts.mainName'));
    const list = await listAccounts(db);
    setAccounts(list);
    setActiveState((cur) => (cur !== ALL_ACCOUNTS && !list.some((a) => a.id === cur) ? ALL_ACCOUNTS : cur));
  };
  useEffect(() => { refresh().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const setActive = (id: string) => { setActiveAccountId(id); setActiveState(id); };
  return { accounts, active, setActive, refresh };
}

export function AccountSwitch({ accounts, active, onChange, money }: { accounts: Account[]; active: string; onChange: (id: string) => void; money?: (a: Account) => string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const current = accounts.find((a) => a.id === active);
  const name = current ? current.name : t('accounts.all');
  return (
    <div className="fx-switch" ref={ref}>
      <button type="button" className="fx-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ic d={ICON.wallet} size={16} />
        <span className="fx-switch-name">{name}</span>
        <Ic d={ICON.down} size={14} />
      </button>
      {open && (
        <div className="fx-menu" role="listbox" aria-label={t('accounts.switch')}>
          <button type="button" role="option" aria-selected={active === ALL_ACCOUNTS} className={active === ALL_ACCOUNTS ? 'on' : ''} onClick={() => { onChange(ALL_ACCOUNTS); setOpen(false); }}>
            <span>{t('accounts.all')}</span>
          </button>
          {accounts.map((a) => (
            <button key={a.id} type="button" role="option" aria-selected={active === a.id} className={active === a.id ? 'on' : ''} onClick={() => { onChange(a.id); setOpen(false); }}>
              <span>{a.name}</span>
              <small>{money ? money(a) : t('accounts.type_' + a.type)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
