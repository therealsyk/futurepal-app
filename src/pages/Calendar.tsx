import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { dailyTotals, buildCalendarGrid, weekdayLabels } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageHead } from '../ui/fx';
import { PeriodFilter, initialPeriod, periodRange, type Period } from '../ui/PeriodFilter';
import { L } from '../i18n/phrases';
import { useIsMobile } from '../ui/useIsMobile';
import { Sponsored } from '../ui/Sponsored';

// SPEC §6.5: grelha por dia com o gasto sob o número; clicar abre o detalhe do dia.
export default function Calendar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = new Date();
  const [per, setPer] = useState<Period>(() => initialPeriod(now));
  const ranged = per.mode === 'range';
  const range = periodRange(per);
  // mês ou ano; com um filtro de datas mostra o mês em que o período acaba (os dias fora do período ficam apagados)
  const calYear = ranged ? +range.to.slice(0, 4) : per.y;
  const calMonth = ranged ? +range.to.slice(5, 7) : per.m + 1;
  const period: 'month' | 'year' = per.mode === 'year' ? 'year' : 'month';
  const [totals, setTotals] = useState<Record<string, number>>({});
  const settings = loadSettings();
  const isMobile = useIsMobile();

  const fromYear = ranged ? +range.from.slice(0, 4) : calYear;
  useEffect(() => {
    (async () => {
      const out: Record<string, number> = {};
      for (let y = fromYear; y <= calYear; y++) Object.assign(out, await dailyTotals(db, y));
      setTotals(out);
    })().catch(() => setTotals({}));
  }, [calYear, fromYear]);

  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];
  const grid = buildCalendarGrid(calYear, calMonth, settings.firstDayOfWeek);
  const iso = (day: number) => `${calYear}-${String(calMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const isToday = (day: number) => calYear === now.getFullYear() && calMonth === now.getMonth() + 1 && day === now.getDate();
  const money = (c: number) => formatMoney(c, settings.currency, settings.language);
  // No telemóvel os quadrados são pequenos: o valor do dia aparece arredondado ao euro (ex.: 650 €).
  const dayMoney = (c: number) => (isMobile
    ? new Intl.NumberFormat(settings.language, { style: 'currency', currency: settings.currency, maximumFractionDigits: 0 }).format(Math.round(c / 100))
    : money(c));

  const prefix = `${calYear}-${String(calMonth).padStart(2, '0')}`;
  const monthValues = Object.entries(totals).filter(([d]) => d.startsWith(prefix));
  const monthTotal = monthValues.reduce((s, [, v]) => s + v, 0);
  const yearTotal = Object.entries(totals).filter(([d]) => d.startsWith(String(calYear))).reduce((a, [, v]) => a + v, 0);
  const rangeTotal = Object.entries(totals).filter(([d]) => d >= range.from && d <= range.to).reduce((a, [, v]) => a + v, 0);
  const outOfRange = (d: string) => ranged && (d < range.from || d > range.to);
  const best = monthValues.sort((a, b) => b[1] - a[1])[0];
  const max = Math.max(1, ...monthValues.map(([, v]) => v));
  const weekdays = isMobile
    ? Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((settings.firstDayOfWeek + i) % 7)).toLocaleDateString(settings.language, { weekday: 'narrow' }))
    : weekdayLabels(settings.language, settings.firstDayOfWeek);

  // Vista de ano: cada mês com o total e um mini-calendário colorido pelo gasto de cada dia.
  const yearMonths = Array.from({ length: 12 }, (_, i) => {
    const p = `${calYear}-${String(i + 1).padStart(2, '0')}`;
    const vals = Object.entries(totals).filter(([d]) => d.startsWith(p));
    return { i, total: vals.reduce((a, [, v]) => a + v, 0), grid: buildCalendarGrid(calYear, i + 1, settings.firstDayOfWeek) };
  });
  const yearMax = Math.max(1, ...Object.values(totals));
  const topMonth = [...yearMonths].sort((a, b) => b.total - a.total)[0];
  const monthsWithSpend = yearMonths.filter((m) => m.total > 0).length;
  const openMonth = (m: number) => setPer({ ...per, mode: 'month', y: calYear, m: m - 1 });

  return (
    <div className="fx-page">
      <PageHead title={t('calendar.title')} sub={t('calendar.subtitle')}>
        <PeriodFilter value={per} onChange={setPer} />
      </PageHead>
      {period === 'year' ? (
        <div className="fx-grid2 wide">
          <div className="cal-year">
            {yearMonths.map((m) => (
              <button type="button" key={m.i} className={'fx-card cal-ym' + (calYear === now.getFullYear() && m.i === now.getMonth() ? ' now' : '')}
                onClick={() => openMonth(m.i + 1)} aria-label={`${monthNames[m.i]} ${calYear}: ${money(m.total)}`}>
                <div className="cal-ym-head"><b>{monthNames[m.i]}</b><span className="fx-num">{m.total > 0 ? money(m.total) : '—'}</span></div>
                <div className="cal-ym-grid" aria-hidden="true">
                  {m.grid.map((day, idx) => {
                    if (day === 0) return <i key={'b' + idx} className="blank" />;
                    const v = totals[`${calYear}-${String(m.i + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`] ?? 0;
                    return <i key={day} style={v > 0 ? { background: `color-mix(in srgb, var(--accent) ${20 + Math.round((v / yearMax) * 70)}%, var(--card-2))` } : undefined} />;
                  })}
                </div>
              </button>
            ))}
          </div>
          <div className="fx-col">
            <div className="fx-card mv-card pco-metric sav cal-metric"><div className="fx-label">{t('calendar.yearTotal')}</div><div className="fx-big pco-value">{money(yearTotal)}</div></div>
            <div className="fx-card mv-card pco-metric sav cal-metric"><div className="fx-label">{t('calendar.monthAverage')}</div><div className="fx-big pco-value">{monthsWithSpend ? money(Math.round(yearTotal / monthsWithSpend)) : '—'}</div></div>
            <div className="fx-card mv-card pco-metric sav cal-metric"><div className="fx-label">{t('calendar.topMonth')}</div>
              <div className="fx-big pco-value">{topMonth && topMonth.total > 0 ? money(topMonth.total) : '—'}</div>
              <p className="fx-muted fx-small">{topMonth && topMonth.total > 0 ? monthNames[topMonth.i] : t('calendar.yearHint')}</p></div>
          </div>
        </div>
      ) : (
      <div className="fx-grid2 wide">
        <div className="fx-card">
          <div className="fx-cal big">
            {weekdays.map((w, i) => <div className="fx-cal-h" key={i}>{w}</div>)}
            {grid.map((day, idx) => {
              if (day === 0) return <div key={`b${idx}`} aria-hidden="true" />;
              const spent = totals[iso(day)] ?? 0;
              return (
                <button type="button" key={day} className={'fx-cal-d' + (isToday(day) ? ' today' : '') + (outOfRange(iso(day)) ? ' out' : '')}
                  style={spent > 0 ? { background: `color-mix(in srgb, var(--accent) ${12 + Math.round((spent / max) * 48)}%, var(--card-2))` } : undefined}
                  aria-label={`${day} ${monthNames[calMonth - 1]} — ${money(spent)}`} onClick={() => navigate(`/dia/${iso(day)}`)}>
                  <span>{day}</span><b>{spent > 0 ? dayMoney(spent) : ''}</b>
                </button>
              );
            })}
          </div>
        </div>
        <div className="fx-col">
          <div className="fx-card mv-card pco-metric sav cal-metric"><div className="fx-label">{ranged ? L('Gasto no período') : t('calendar.monthTotal')}</div><div className="fx-big pco-value">{money(ranged ? rangeTotal : monthTotal)}</div></div>
          <div className="fx-card mv-card pco-metric sav cal-metric"><div className="fx-label">{t('calendar.yearTotal')}</div><div className="fx-big pco-value">{money(yearTotal)}</div></div>
          <div className="fx-card mv-card pco-metric sav cal-metric"><div className="fx-label">{t('calendar.topDay')}</div>
            <div className="fx-big pco-value">{best ? money(best[1]) : '—'}</div>
            <p className="fx-muted fx-small">{best ? best[0] : t('calendar.dayPanelHint')}</p></div>
        </div>
      </div>
      )}
      <Sponsored place="Calendar" />
    </div>
  );
}
