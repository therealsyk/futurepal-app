import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Category } from '../db/database';
import { catalogItem, groupOf, iconPathOf, GROUP_ORDER } from '../core/categoryCatalog';
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

// Ícone redondo de uma categoria (cor do grupo + ícone do catálogo; ou a imagem própria, se a pessoa a escolheu).
export function CatIcon({ cat, size = 40 }: { cat: { icon?: string; nameKey?: string; image?: string; color?: string; group?: string }; size?: number }) {
  if (cat.image && cat.image.startsWith('data:')) {
    return <img className="fx-caticon img" src={cat.image} alt="" style={{ width: size, height: size }} />;
  }
  const color = cat.color || catalogItem(cat.nameKey)?.color || 'var(--accent)';
  return (
    <span className="fx-caticon" style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 22%, var(--card-2))`, color }} aria-hidden="true">
      <Ic d={iconPathOf(cat)} size={Math.round(size * 0.5)} />
    </span>
  );
}

// <select> de categorias agrupado (com 60+ categorias, a lista fica legível por grupos).
type CatLike = Pick<Category, 'id' | 'name'> & { nameKey?: string; group?: string };
// Rendimentos só mostram categorias de rendimento (e poupança/outros/próprias); despesas nunca mostram as de rendimento.
const INCOME_GROUPS = new Set(['income', 'savings', 'misc', 'custom']);
export function catFitsKind(c: { group?: string; nameKey?: string }, kind: 'expense' | 'income'): boolean {
  const g = groupOf(c);
  return kind === 'income' ? INCOME_GROUPS.has(g) : g !== 'income';
}

export function CategorySelect({ cats: all, value, onChange, className = 'fx-input', ariaLabel, emptyLabel, optionValue, kind }: {
  cats: CatLike[]; value: string; onChange: (v: string) => void; className?: string; ariaLabel?: string; emptyLabel?: string;
  optionValue?: (c: CatLike) => string; kind?: 'expense' | 'income';
}) {
  const { t } = useTranslation();
  const val = optionValue ?? ((c: CatLike) => c.id);
  const cats = kind ? all.filter((c) => catFitsKind(c, kind)) : all;
  // Ao trocar entre despesa e rendimento, se a categoria escolhida deixar de servir, passa para a primeira que serve.
  useEffect(() => {
    if (!kind || cats.length === 0 || (value === '' && emptyLabel !== undefined)) return;
    if (!cats.some((c) => val(c) === value)) {
      const first = kind === 'income' ? (cats.find((c) => groupOf(c) === 'income') ?? cats[0]) : cats[0];
      onChange(val(first));
    }
  }, [kind, value, all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0); // opção realçada pelo teclado
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const groups = GROUP_ORDER.map((g) => ({
    g,
    items: cats.filter((c) => groupOf(c) === g && (!q || norm(catLabel(t, c)).includes(norm(q)) || norm(t('categoryGroups.' + g)).includes(norm(q))))
      .sort((a, b) => catLabel(t, a).localeCompare(catLabel(t, b))),
  })).filter((x) => x.items.length > 0);
  // lista plana (para o teclado): [vazio?, ...categorias por grupo]
  const flat: Array<{ v: string; label: string }> = [
    ...(emptyLabel !== undefined && !q ? [{ v: '', label: emptyLabel }] : []),
    ...groups.flatMap((x) => x.items.map((c) => ({ v: val(c), label: catLabel(t, c) }))),
  ];
  const current = value === '' && emptyLabel !== undefined ? emptyLabel : (() => { const c = all.find((x) => val(x) === value); return c ? catLabel(t, c) : ''; })();
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); btnRef.current?.focus(); };
  useEffect(() => { if (open) { setHi(Math.max(0, flat.findIndex((o) => o.v === value))); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (q) setHi(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('[data-hi="1"]')?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[hi]) pick(flat[hi].v); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQ(''); btnRef.current?.focus(); }
  };
  let n = -1;
  return (
    <>
      <button ref={btnRef} type="button" className={className + ' fx-selectbtn'} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel ? `${ariaLabel}: ${current}` : current}
        onClick={() => setOpen(!open)}>
        <span>{current || '—'}</span>
        <Ic d={ICON.down} size={14} />
      </button>
      <Popover anchor={btnRef} open={open} onClose={() => { setOpen(false); setQ(''); }} minWidth={260}>
        <div className="fx-pop-search">
          <Ic d={ICON.search} size={15} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('transactions.searchCategory')} aria-label={t('transactions.searchCategory')} />
        </div>
        <div className="fx-pop-list" role="listbox" aria-label={ariaLabel} ref={listRef}>
          {emptyLabel !== undefined && !q && (() => { n++; const i = n; return (
            <button type="button" role="option" aria-selected={value === ''} data-hi={hi === i ? '1' : undefined} className={(value === '' ? 'on' : '') + (hi === i ? ' hi' : '')}
              onMouseEnter={() => setHi(i)} onClick={() => pick('')}>{emptyLabel}</button>
          ); })()}
          {groups.map(({ g, items }) => (
            <div key={g} role="group" aria-label={t('categoryGroups.' + g)}>
              <div className="fx-pop-group">{t('categoryGroups.' + g)}</div>
              {items.map((c) => { n++; const i = n; const v = val(c); return (
                <button key={c.id} type="button" role="option" aria-selected={v === value} data-hi={hi === i ? '1' : undefined}
                  className={(v === value ? 'on' : '') + (hi === i ? ' hi' : '')} onMouseEnter={() => setHi(i)} onClick={() => pick(v)}>
                  {catLabel(t, c)}
                </button>
              ); })}
            </div>
          ))}
          {flat.length === 0 && <p className="fx-pop-empty">{t('transactions.noCategoryFound')}</p>}
        </div>
      </Popover>
    </>
  );
}

/** Painel flutuante preso a um botão (abre para baixo, ou para cima se não houver espaço). Vai para o <body>,
 *  por isso não fica cortado dentro de janelas com scroll. */
export function Popover({ anchor, open, onClose, children, minWidth = 220, className = '' }: {
  anchor: { current: HTMLElement | null }; open: boolean; onClose: () => void; children: ReactNode; minWidth?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const width = Math.min(Math.max(a.width, minWidth), vw - 16);
      const left = Math.min(Math.max(8, a.left), vw - width - 8);
      const below = vh - a.bottom - 12, above = a.top - 12;
      if (below >= 300 || below >= above) setPos({ left, top: a.bottom + 6, width, maxH: Math.min(420, below) });
      else setPos({ left, bottom: vh - a.top + 6, width, maxH: Math.min(420, above) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchor, minWidth]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (ref.current?.contains(tg) || anchor.current?.contains(tg)) return;
      onClose();
    };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', h, true);
    document.addEventListener('keydown', k, true);
    return () => { document.removeEventListener('mousedown', h, true); document.removeEventListener('keydown', k, true); };
  }, [open, onClose, anchor]);
  if (!open || !pos) return null;
  return createPortal(
    <div ref={ref} className={'fx-pop ' + className} onMouseDown={(e) => e.stopPropagation()}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH }}>
      {children}
    </div>,
    document.body,
  );
}

// Menu de escolha com o mesmo visual do seletor de contas (substitui o <select> nativo, que abre com o estilo do sistema).
export function PickMenu<T extends string | number>({ value, options, onChange, label, testId, compact }: {
  value: T; options: Array<{ value: T; label: string; sub?: string }>; onChange: (v: T) => void; label: string; testId?: string; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    // a opção escolhida fica visível e com foco (útil numa lista de 12 meses)
    const cur = listRef.current?.querySelector<HTMLButtonElement>('button.on') ?? listRef.current?.querySelector<HTMLButtonElement>('button');
    cur?.scrollIntoView({ block: 'nearest' });
    cur?.focus();
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const current = options.find((o) => o.value === value);
  const pick = (v: T) => { onChange(v); setOpen(false); };
  const onKey = (e: ReactKeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { setOpen(false); (ref.current?.querySelector('button') as HTMLButtonElement | null)?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
  };
  return (
    <div className={'fx-switch fx-pick' + (compact ? ' compact' : '')} ref={ref} onKeyDown={open ? onKey : undefined}>
      <button type="button" className="fx-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label ?? ''}`}
        onClick={() => setOpen(!open)} data-testid={testId}>
        <span className="fx-switch-name">{current?.label ?? ''}</span>
        <Ic d={ICON.down} size={14} />
      </button>
      {open && (
        <div className="fx-menu fx-pick-menu" role="listbox" aria-label={label} ref={listRef}>
          {options.map((o) => (
            <button key={String(o.value)} type="button" role="option" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => pick(o.value)}>
              <span>{o.label}</span>
              {o.sub ? <small>{o.sub}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
