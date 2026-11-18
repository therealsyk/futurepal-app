import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { liveQuery } from 'dexie';
import { db } from '../db/app-db';
import { loadSettings } from '../core/settings';
import { formatMoney } from '../core/money';
import { todayISO } from '../core/dates';
import { Ic, ICON, Popover } from './fx';

const pad = (n: number) => String(n).padStart(2, '0');
const CAL = 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4';

/** Mostra a data no formato escolhido nas definições (DD/MM/AAAA, MM/DD/AAAA ou AAAA-MM-DD). */
export function formatDateShort(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  const f = loadSettings().dateFormat;
  return f === 'MDY' ? `${m}/${d}/${y}` : f === 'YMD' ? `${y}-${m}-${d}` : `${d}/${m}/${y}`;
}

/** Gastos (despesas) de cada dia de um mês, sempre atualizados (liveQuery acompanha a base de dados). */
function useMonthSpend(y: number, m: number, on: boolean): number[] {
  const [spend, setSpend] = useState<number[]>([]);
  useEffect(() => {
    if (!on) return;
    const days = new Date(y, m + 1, 0).getDate();
    const start = `${y}-${pad(m + 1)}-01`, end = `${y}-${pad(m + 1)}-${pad(days)}`;
    const sub = liveQuery(() => db.transactions.where('date').between(start, end, true, true).toArray()).subscribe({
      next: (rows) => {
        const out = new Array<number>(days + 1).fill(0);
        for (const tx of rows) if (tx.deletedAt === null && tx.type === 'expense') out[parseInt(tx.date.slice(8, 10), 10)] += tx.amountCents;
        setSpend(out);
      },
      error: () => setSpend([]),
    });
    return () => sub.unsubscribe();
  }, [y, m, on]);
  return spend;
}

/** Escolher uma data com um calendário igual ao do Painel: cada dia mostra quanto se gastou nesse dia. */
export function DatePicker({ value, onChange, ariaLabel, allowEmpty, className = 'fx-input', testId }: {
  value: string; onChange: (iso: string) => void; ariaLabel?: string; allowEmpty?: boolean; className?: string; testId?: string;
}) {
  const { t } = useTranslation();
  const settings = loadSettings();
  const lang = settings.language;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const base = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayISO();
  const [cur, setCur] = useState({ y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 });
  useEffect(() => { if (open) setCur({ y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const spend = useMonthSpend(cur.y, cur.m, open);
  const money = (c: number) => formatMoney(c, settings.currency, lang);

  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const first = settings.firstDayOfWeek ?? 1;
  const lead = (new Date(cur.y, cur.m, 1).getDay() - first + 7) % 7;
  const wk = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(lang, { weekday: 'narrow' }));
  const title = new Date(cur.y, cur.m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const today = todayISO();
  const total = spend.reduce((a, b) => a + b, 0);
  const move = (n: number) => setCur((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const pick = (iso: string) => { onChange(iso); setOpen(false); btnRef.current?.focus(); };

  return (
    <>
      <button ref={btnRef} type="button" className={className + ' fx-selectbtn'} aria-haspopup="dialog" aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${formatDateShort(value)}` : undefined} onClick={() => setOpen(!open)} data-testid={testId}>
        <span className={value ? '' : 'fx-muted'}>{value ? formatDateShort(value) : t('datePicker.none')}</span>
        <Ic d={CAL} size={15} />
      </button>
      <Popover anchor={btnRef} open={open} onClose={() => setOpen(false)} minWidth={320} className="fx-datepop">
        <div className="fx-dp-head">
          <button type="button" className="fx-round sm" onClick={() => move(-1)} aria-label={t('panel.prevMonth')}><Ic d={ICON.left} size={14} /></button>
          <div className="fx-dp-title"><b>{title.charAt(0).toUpperCase() + title.slice(1)}</b><small>{total > 0 ? t('datePicker.spent', { value: money(total) }) : t('datePicker.noSpend')}</small></div>
          <button type="button" className="fx-round sm" onClick={() => move(1)} aria-label={t('panel.nextMonth')}><Ic d={ICON.right} size={14} /></button>
        </div>
        <div className="fx-cal fx-dp-grid" role="grid" aria-label={title}>
          {wk.map((w, i) => <span key={i} className="fx-cal-h">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={'e' + i} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1;
            const iso = `${cur.y}-${pad(cur.m + 1)}-${pad(d)}`;
            const v = spend[d] ?? 0;
            return (
              <button key={d} type="button" className={'fx-cal-d' + (iso === value ? ' sel' : '') + (iso === today ? ' now' : '')}
                onClick={() => pick(iso)} aria-label={`${d}: ${money(v)}`} aria-pressed={iso === value}>
                <span>{d}</span>
                <b>{v > 0 ? money(v) : ''}</b>
              </button>
            );
          })}
        </div>
        <div className="fx-dp-foot">
          {allowEmpty && value ? <button type="button" className="fx-btn" onClick={() => pick('')}>{t('datePicker.clear')}</button> : <span />}
          <button type="button" className="fx-btn" onClick={() => pick(today)}>{t('datePicker.today')}</button>
        </div>
      </Popover>
    </>
  );
}
