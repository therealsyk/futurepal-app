// Filtro de período partilhado (PC e telemóvel), pensado para ser fácil para qualquer pessoa:
//   [ Mensal | Anual ]  ‹ novembro de 2026 ›   [ Filtrar ▾ ]
// "Filtrar" abre um menu: Último mês, Último trimestre, Último semestre, Outras datas…
// "Outras datas…" abre no meio do ecrã o calendário (com o que se gastou em cada dia) e duas caixas: De / Até.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Ic, ICON } from './fx';
import { formatDateShort, useMonthSpend } from './DatePicker';
import { loadSettings } from '../core/settings';
import { formatMoney } from '../core/money';

export type Preset = 'm1' | 'q' | 's' | 'custom';
export interface Period { mode: 'month' | 'year' | 'range'; y: number; m: number; preset: Preset; from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const FILTER = 'M4 5h16l-6 8v5l-4 2v-7z';

export function presetRange(p: Exclude<Preset, 'custom'>, today = new Date()): { from: string; to: string } {
  const n = p === 'm1' ? 1 : p === 'q' ? 3 : 6;
  const f = new Date(today.getFullYear(), today.getMonth() - n, today.getDate() + 1);
  return { from: iso(f), to: iso(today) };
}
export function initialPeriod(today = new Date()): Period {
  return { mode: 'month', y: today.getFullYear(), m: today.getMonth(), preset: 'm1', ...presetRange('m1', today) };
}
/** Intervalo de datas (inclusive) do período escolhido. */
export function periodRange(p: Period): { from: string; to: string } {
  if (p.mode === 'range') return { from: p.from, to: p.to };
  if (p.mode === 'year') return { from: `${p.y}-01-01`, to: `${p.y}-12-31` };
  return { from: iso(new Date(p.y, p.m, 1)), to: iso(new Date(p.y, p.m + 1, 0)) };
}
/** Período anterior com a mesma duração (para as comparações em %). */
export function previousRange(p: Period): { from: string; to: string } {
  if (p.mode === 'year') return { from: `${p.y - 1}-01-01`, to: `${p.y - 1}-12-31` };
  if (p.mode === 'month') return periodRange({ ...p, y: p.m === 0 ? p.y - 1 : p.y, m: (p.m + 11) % 12 });
  const a = new Date(p.from + 'T00:00:00'), b = new Date(p.to + 'T00:00:00');
  const days = Math.round((b.getTime() - a.getTime()) / 864e5) + 1;
  return { from: iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - days)), to: iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1)) };
}

/** Calendário no meio do ecrã para escolher "de" e "até". */
function RangeModal({ from, to, onApply, onClose }: { from: string; to: string; onApply: (f: string, t: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const s = loadSettings();
  const lang = s.language;
  const [a, setA] = useState(from), [b, setB] = useState(to);
  const [edit, setEdit] = useState<'from' | 'to'>('from');
  const [cur, setCur] = useState({ y: +from.slice(0, 4), m: +from.slice(5, 7) - 1 });
  const spend = useMonthSpend(cur.y, cur.m, true);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const first = s.firstDayOfWeek ?? 1;
  const lead = (new Date(cur.y, cur.m, 1).getDay() - first + 7) % 7;
  const wk = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(lang, { weekday: 'narrow' }));
  const title = new Date(cur.y, cur.m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const move = (n: number) => setCur((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const narrow = window.innerWidth < 768;
  const dayMoney = (c: number) => new Intl.NumberFormat(lang, { style: 'currency', currency: s.currency, maximumFractionDigits: narrow ? 0 : 2 }).format(narrow ? Math.round(c / 100) : c / 100);
  const pick = (d: string) => {
    if (edit === 'from') { setA(d); if (d > b) setB(d); setEdit('to'); }
    else if (d < a) { setA(d); setEdit('to'); }
    else { setB(d); }
  };
  const total = spend.reduce((x, y) => x + y, 0);
  return createPortal(
    <div className="pf-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal" role="dialog" aria-modal="true" aria-label={t('period.custom')}>
        <h2>{t('period.pickTitle')}</h2>
        <div className="pf-boxes">
          <button type="button" className={'pf-box' + (edit === 'from' ? ' on' : '')} onClick={() => setEdit('from')}><small>{t('period.from')}</small><b>{formatDateShort(a)}</b></button>
          <Ic d={ICON.right} size={18} />
          <button type="button" className={'pf-box' + (edit === 'to' ? ' on' : '')} onClick={() => setEdit('to')}><small>{t('period.to')}</small><b>{formatDateShort(b)}</b></button>
        </div>
        <p className="pf-help">{t(edit === 'from' ? 'period.tapFrom' : 'period.tapTo')}</p>
        <div className="fx-dp-head">
          <button type="button" className="fx-round" onClick={() => move(-1)} aria-label={t('panel.prevMonth')}><Ic d={ICON.left} size={16} /></button>
          <div className="fx-dp-title"><b>{title.charAt(0).toUpperCase() + title.slice(1)}</b><small>{total > 0 ? t('datePicker.spent', { value: formatMoney(total, s.currency, lang) }) : t('datePicker.noSpend')}</small></div>
          <button type="button" className="fx-round" onClick={() => move(1)} aria-label={t('panel.nextMonth')}><Ic d={ICON.right} size={16} /></button>
        </div>
        <div className="fx-cal fx-dp-grid pf-grid" role="grid" aria-label={title}>
          {wk.map((w, i) => <span key={i} className="fx-cal-h">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={'e' + i} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1, di = `${cur.y}-${pad(cur.m + 1)}-${pad(d)}`, v = spend[d] ?? 0;
            const cls = (di === a || di === b ? ' sel' : di > a && di < b ? ' mid' : '');
            return (
              <button key={d} type="button" className={'fx-cal-d' + cls} onClick={() => pick(di)} aria-pressed={di === a || di === b}>
                <span>{d}</span><b>{v > 0 ? dayMoney(v) : ''}</b>
              </button>
            );
          })}
        </div>
        <div className="pf-modal-foot">
          <button type="button" className="pf-btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="pf-btn primary" onClick={() => onApply(a, b)}>{t('period.apply')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useTranslation();
  const lang = loadSettings().language;
  const p = value;
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);
  const ranged = p.mode === 'range';
  const shift = (d: number) => onChange(p.mode === 'year' ? { ...p, y: p.y + d } : { ...p, y: p.y + Math.floor((p.m + d) / 12), m: ((p.m + d) % 12 + 12) % 12 });
  const label = p.mode === 'year' ? String(p.y) : new Date(p.y, p.m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const choose = (pr: Exclude<Preset, 'custom'>) => { onChange({ ...p, mode: 'range', preset: pr, ...presetRange(pr) }); setMenu(false); };
  const rangeLabel = p.preset === 'custom' ? `${formatDateShort(p.from)} – ${formatDateShort(p.to)}` : t('period.' + p.preset);
  return (
    <div className="pf">
      <div className="sh-seg pf-seg" role="tablist" aria-label={t('pco.summary')}>
        <button type="button" role="tab" aria-selected={p.mode === 'month'} className={p.mode === 'month' ? 'on' : ''} onClick={() => onChange({ ...p, mode: 'month' })}>{t('period.month')}</button>
        <button type="button" role="tab" aria-selected={p.mode === 'year'} className={p.mode === 'year' ? 'on' : ''} onClick={() => onChange({ ...p, mode: 'year' })}>{t('period.year')}</button>
      </div>
      {ranged ? (
        <div className="sh-monthnav pf-nav pf-active">
          <Ic d={FILTER} size={16} />
          <span className="mv-month">{rangeLabel}</span>
          <button type="button" className="mv-chev" onClick={() => onChange({ ...p, mode: 'month' })} aria-label={t('period.clear')}><Ic d={ICON.close} size={16} /></button>
        </div>
      ) : (
        <div className="sh-monthnav pf-nav">
          <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={t(p.mode === 'year' ? 'pco.prevYear' : 'pco.prevMonth')}><Ic d={ICON.left} size={18} /></button>
          <span className="mv-month">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
          <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={t(p.mode === 'year' ? 'pco.nextYear' : 'pco.nextMonth')}><Ic d={ICON.right} size={18} /></button>
        </div>
      )}
      <div className="pf-filter" ref={ref}>
        <button type="button" className={'pf-fbtn' + (ranged ? ' on' : '')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Ic d={FILTER} size={17} />{t('period.filter')}<Ic d={ICON.down} size={14} />
        </button>
        {menu && (
          <div className="pf-menu" role="menu">
            {(['m1', 'q', 's'] as const).map((k) => (
              <button key={k} type="button" role="menuitem" className={ranged && p.preset === k ? 'on' : ''} onClick={() => choose(k)}>{t('period.' + k)}</button>
            ))}
            <button type="button" role="menuitem" className={ranged && p.preset === 'custom' ? 'on' : ''} onClick={() => { setMenu(false); setModal(true); }}>{t('period.custom')}</button>
          </div>
        )}
      </div>
      {modal && <RangeModal from={p.from} to={p.to} onClose={() => setModal(false)} onApply={(f, to) => { onChange({ ...p, mode: 'range', preset: 'custom', from: f, to }); setModal(false); }} />}
    </div>
  );
}
