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
import { Metric } from './PcOverview';
import { previousRange } from '../ui/PeriodFilter';
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
      for (let y = fromYear - 1; y <= calYear; y++) Object.assign(out, await dailyTotals(db, y));
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
  // comparações (como no Resumo): mês vs mês anterior, ano vs ano anterior, período vs período anterior
  const sumBetween = (f: string, to: string) => Object.entries(totals).filter(([d]) => d >= f && d <= to).reduce((a, [, v]) => a + v, 0);
  const pm = new Date(calYear, calMonth - 2, 1);
  const pmKey = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthTotal = sumBetween(pmKey + '-01', pmKey + '-31');
  const prevYearTotal = sumBetween(`${calYear - 1}-01-01`, `${calYear - 1}-12-31`);
  const pr = previousRange(per);
  const prevRangeTotal = sumBetween(pr.from, pr.to);
  // média por mês do ano anterior (só meses com gastos), para a comparação na vista anual
  const prevMonths = Array.from({ length: 12 }, (_, i) => sumBetween(`${calYear - 1}-${String(i + 1).padStart(2, '0')}-01`, `${calYear - 1}-${String(i + 1).padStart(2, '0')}-31`));
  const prevAvg = prevMonths.filter((v) => v > 0).length ? prevMonths.reduce((x, y) => x + y, 0) / prevMonths.filter((v) => v > 0).length : 0;
  const dl = (n: number, b: number) => (b === 0 ? null : (n - b) / b);
  const vs = t('pco.vs');
  const prevMonthName = pm.toLocaleDateString(settings.language, { month: 'long' });
  const IC_SPENT = 'M12 5v14M5 12l7 7 7-7', IC_CAL = 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', IC_TOP = 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z';
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
      <PageHead title={t('calendar.title')}>
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
            <Metric icon={IC_SPENT} tone="exp" title={t('calendar.yearTotal')} value={money(yearTotal)} valueClass={yearTotal > 0 ? 'fx-neg' : ''} delta={dl(yearTotal, prevYearTotal)} deltaGoodUp={false} prevName={String(calYear - 1)} vsLabel={vs} bar={1} />
            <Metric icon={IC_CAL} tone="sav" title={t('calendar.monthAverage')} value={monthsWithSpend ? money(Math.round(yearTotal / monthsWithSpend)) : '—'} delta={monthsWithSpend && prevAvg ? dl(yearTotal / monthsWithSpend, prevAvg) : null} deltaGoodUp={false} prevName={String(calYear - 1)} vsLabel={vs} bar={yearMax > 0 && monthsWithSpend ? Math.min(1, (yearTotal / monthsWithSpend) / Math.max(1, topMonth?.total ?? 1)) : 0} />
            <Metric icon={IC_TOP} tone="inc" title={t('calendar.topMonth')} value={topMonth && topMonth.total > 0 ? money(topMonth.total) : '—'} delta={null} deltaGoodUp={false} prevName="" vsLabel="" sub={topMonth && topMonth.total > 0 ? monthNames[topMonth.i] : t('calendar.yearHint')} bar={topMonth && yearTotal > 0 ? topMonth.total / yearTotal : 0} />
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
          <Metric icon={IC_SPENT} tone="exp" title={ranged ? L('Gasto no período') : t('calendar.monthTotal')} value={money(ranged ? rangeTotal : monthTotal)} valueClass="fx-neg" delta={ranged ? dl(rangeTotal, prevRangeTotal) : dl(monthTotal, prevMonthTotal)} deltaGoodUp={false} prevName={ranged ? t('pco.prev_' + per.preset) : prevMonthName} vsLabel={vs} bar={1} />
          <Metric icon={IC_TOP} tone="inc" title={t('calendar.topDay')} value={best ? money(best[1]) : '—'} delta={null} deltaGoodUp={false} prevName="" vsLabel="" sub={best ? new Date(best[0] + 'T00:00:00').toLocaleDateString(settings.language, { day: 'numeric', month: 'long' }) : t('calendar.dayPanelHint')} bar={best && monthTotal > 0 ? best[1] / monthTotal : 0} />
        </div>
      </div>
      )}
      <Sponsored place="Calendar" />
    </div>
  );
}
