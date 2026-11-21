// Filtro de período partilhado: Mensal | Anual | Período (último mês, trimestre, semestre ou datas à escolha).
import { useTranslation } from 'react-i18next';
import { Ic, ICON } from './fx';
import { DatePicker } from './DatePicker';
import { loadSettings } from '../core/settings';

export type Preset = 'm1' | 'q' | 's' | 'custom';
export interface Period { mode: 'month' | 'year' | 'range'; y: number; m: number; preset: Preset; from: string; to: string }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function presetRange(p: Exclude<Preset, 'custom'>, today = new Date()): { from: string; to: string } {
  const n = p === 'm1' ? 1 : p === 'q' ? 3 : 6;
  const f = new Date(today.getFullYear(), today.getMonth() - n, today.getDate() + 1);
  return { from: iso(f), to: iso(today) };
}
export function initialPeriod(today = new Date()): Period {
  const r = presetRange('m1', today);
  return { mode: 'month', y: today.getFullYear(), m: today.getMonth(), preset: 'm1', ...r };
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

export function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useTranslation();
  const lang = loadSettings().language;
  const p = value;
  const shift = (d: number) => onChange(p.mode === 'year' ? { ...p, y: p.y + d } : { ...p, y: p.y + Math.floor((p.m + d) / 12), m: ((p.m + d) % 12 + 12) % 12 });
  const label = p.mode === 'year' ? String(p.y) : new Date(p.y, p.m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const setPreset = (pr: Preset) => onChange({ ...p, mode: 'range', preset: pr, ...(pr === 'custom' ? {} : presetRange(pr)) });
  return (
    <div className="pf">
      <div className="sh-seg pf-seg" role="tablist" aria-label={t('pco.summary')}>
        <button type="button" role="tab" aria-selected={p.mode === 'month'} className={p.mode === 'month' ? 'on' : ''} onClick={() => onChange({ ...p, mode: 'month' })}>{t('pco.monthly')}</button>
        <button type="button" role="tab" aria-selected={p.mode === 'year'} className={p.mode === 'year' ? 'on' : ''} onClick={() => onChange({ ...p, mode: 'year' })}>{t('pco.yearly')}</button>
        <button type="button" role="tab" aria-selected={p.mode === 'range'} className={p.mode === 'range' ? 'on' : ''} onClick={() => setPreset(p.preset)}>{t('period.range')}</button>
      </div>
      {p.mode !== 'range' ? (
        <div className="sh-monthnav pf-nav">
          <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={t(p.mode === 'year' ? 'pco.prevYear' : 'pco.prevMonth')}><Ic d={ICON.left} size={18} /></button>
          <span className="mv-month">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
          <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={t(p.mode === 'year' ? 'pco.nextYear' : 'pco.nextMonth')}><Ic d={ICON.right} size={18} /></button>
        </div>
      ) : (
        <div className="pf-range">
          {(['m1', 'q', 's', 'custom'] as Preset[]).map((k) => (
            <button key={k} type="button" className={'pf-chip' + (p.preset === k ? ' on' : '')} onClick={() => setPreset(k)}>{t('period.' + k)}</button>
          ))}
          {p.preset === 'custom' && (<span className="pf-dates">
            <DatePicker value={p.from} onChange={(v) => onChange({ ...p, from: v, to: v > p.to ? v : p.to })} ariaLabel={t('period.from')} />
            <span>–</span>
            <DatePicker value={p.to} onChange={(v) => onChange({ ...p, to: v, from: v < p.from ? v : p.from })} ariaLabel={t('period.to')} />
          </span>)}
        </div>
      )}
    </div>
  );
}
