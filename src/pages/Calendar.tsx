import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { dailyTotals, buildCalendarGrid, weekdayLabels } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageHead, MonthNav } from '../ui/fx';

// SPEC §6.5: grelha por dia com o gasto sob o número; clicar abre o detalhe do dia.
export default function Calendar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [period, setPeriod] = useState<'month' | 'year'>('month'); // um mês, ou os 12 meses do ano
  const [totals, setTotals] = useState<Record<string, number>>({});
  const settings = loadSettings();

  useEffect(() => { dailyTotals(db, calYear).then(setTotals).catch(() => setTotals({})); }, [calYear]);

  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];
  const grid = buildCalendarGrid(calYear, calMonth, settings.firstDayOfWeek);
  const iso = (day: number) => `${calYear}-${String(calMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const isToday = (day: number) => calYear === now.getFullYear() && calMonth === now.getMonth() + 1 && day === now.getDate();
  const money = (c: number) => formatMoney(c, settings.currency, settings.language);
  const shift = (d: number) => {
    if (period === 'year') { setCalYear((y) => y + d); return; }
    let m = calMonth + d, y = calYear;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setCalMonth(m); setCalYear(y);
  };

  const prefix = `${calYear}-${String(calMonth).padStart(2, '0')}`;
  const monthValues = Object.entries(totals).filter(([d]) => d.startsWith(prefix));
  const monthTotal = monthValues.reduce((s, [, v]) => s + v, 0);
  const yearTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  const best = monthValues.sort((a, b) => b[1] - a[1])[0];
  const max = Math.max(1, ...monthValues.map(([, v]) => v));
  const weekdays = weekdayLabels(settings.language, settings.firstDayOfWeek);

  // Vista de ano: cada mês com o total e um mini-calendário colorido pelo gasto de cada dia.
  const yearMonths = Array.from({ length: 12 }, (_, i) => {
    const p = `${calYear}-${String(i + 1).padStart(2, '0')}`;
    const vals = Object.entries(totals).filter(([d]) => d.startsWith(p));
    return { i, total: vals.reduce((a, [, v]) => a + v, 0), grid: buildCalendarGrid(calYear, i + 1, settings.firstDayOfWeek) };
  });
  const yearMax = Math.max(1, ...Object.values(totals));
  const topMonth = [...yearMonths].sort((a, b) => b.total - a.total)[0];
  const monthsWithSpend = yearMonths.filter((m) => m.total > 0).length;
  const openMonth = (m: number) => { setCalMonth(m); setPeriod('month'); };

  return (
    <div className="fx-page">
      <PageHead title={t('calendar.title')} sub={t('calendar.subtitle')}>
        <div className="fx-seg" role="group" aria-label={t('panel.period')}>
          <button type="button" className={period === 'month' ? 'on' : ''} aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>{t('panel.periodMonth')}</button>
          <button type="button" className={period === 'year' ? 'on' : ''} aria-pressed={period === 'year'} onClick={() => setPeriod('year')}>{t('panel.periodYear')}</button>
        </div>
        <MonthNav label={period === 'month' ? `${monthNames[calMonth - 1]} ${calYear}` : String(calYear)} onPrev={() => shift(-1)} onNext={() => shift(1)} />
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
            <div className="fx-card"><div className="fx-label">{t('calendar.yearTotal')}</div><div className="fx-big" style={{ marginTop: 6 }}>{money(yearTotal)}</div></div>
            <div className="fx-card"><div className="fx-label">{t('calendar.monthAverage')}</div><div className="fx-big" style={{ marginTop: 6 }}>{monthsWithSpend ? money(Math.round(yearTotal / monthsWithSpend)) : '—'}</div></div>
            <div className="fx-card"><div className="fx-label">{t('calendar.topMonth')}</div>
              <div className="fx-big" style={{ marginTop: 6 }}>{topMonth && topMonth.total > 0 ? money(topMonth.total) : '—'}</div>
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
                <button type="button" key={day} className={'fx-cal-d' + (isToday(day) ? ' today' : '')}
                  style={spent > 0 ? { background: `color-mix(in srgb, var(--accent) ${12 + Math.round((spent / max) * 48)}%, var(--card-2))` } : undefined}
                  aria-label={`${day} ${monthNames[calMonth - 1]} — ${money(spent)}`} onClick={() => navigate(`/dia/${iso(day)}`)}>
                  <span>{day}</span><b>{spent > 0 ? money(spent) : ''}</b>
                </button>
              );
            })}
          </div>
        </div>
        <div className="fx-col">
          <div className="fx-card"><div className="fx-label">{t('calendar.monthTotal')}</div><div className="fx-big" style={{ marginTop: 6 }}>{money(monthTotal)}</div></div>
          <div className="fx-card"><div className="fx-label">{t('calendar.yearTotal')}</div><div className="fx-big" style={{ marginTop: 6 }}>{money(yearTotal)}</div></div>
          <div className="fx-card"><div className="fx-label">{t('calendar.topDay')}</div>
            <div className="fx-big" style={{ marginTop: 6 }}>{best ? money(best[1]) : '—'}</div>
            <p className="fx-muted fx-small">{best ? best[0] : t('calendar.dayPanelHint')}</p></div>
        </div>
      </div>
      )}
    </div>
  );
}
