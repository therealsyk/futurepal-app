import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { dailyTotals, buildCalendarGrid } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';

// SPEC §6.5 / Prompt 5: grid by day with amount spent under the day number;
// month arrows; clicking a day navigates to that day's expense detail page.
export default function Calendar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [settings, setSettings] = useState(loadSettings());
  const [totals, setTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    setSettings(loadSettings());
    dailyTotals(db, calYear)
      .then(setTotals)
      .catch(() => setTotals({}));
  }, [calYear]);

  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];
  const grid = buildCalendarGrid(calYear, calMonth);
  const isToday = (day: number) =>
    calYear === now.getFullYear() && calMonth === now.getMonth() + 1 && day === now.getDate();

  const iso = (day: number) => `${calYear}-${String(calMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const shiftMonth = (delta: number) => {
    let y = calYear;
    let m = calMonth + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setCalYear(y);
    setCalMonth(m);
  };

  const openDay = (day: number) => {
    navigate(`/dia/${iso(day)}`);
  };

  return (
    <div>
      <h1 className="page-title">{t('calendar.title')}</h1>
      <div className="cal-nav">
        <button className="cal-arrow" onClick={() => shiftMonth(-1)} aria-label={t('calendar.prevMonth')}>
          ←
        </button>
        <span className="cal-month-label">
          {monthNames[calMonth - 1]} {calYear}
        </span>
        <button className="cal-arrow" onClick={() => shiftMonth(1)} aria-label={t('calendar.nextMonth')}>
          →
        </button>
      </div>

      <div className="card">
        <div className="cal-weekdays">
          {grid.map((d) => (
            <span key={d}>{new Intl.DateTimeFormat(settings.language, { weekday: 'short' }).format(new Date(calYear, calMonth - 1, d))}</span>
          ))}
        </div>
        <div className="cal-grid">
          {grid.map((day) => {
            const date = iso(day);
            const spent = totals[date] ?? 0;
            return (
              <button
                key={day}
                type="button"
                className={`cal-day${isToday(day) ? ' is-today' : ''}`}
                aria-label={`${monthNames[calMonth - 1]} ${day}, ${calYear} — ${formatMoney(spent, settings.currency, settings.language)}`}
                onClick={() => openDay(day)}
                title={`${date} — ${formatMoney(spent, settings.currency, settings.language)}`}
              >
                <span className="cal-day-num">{day}</span>
                <span className={`cal-day-amount${spent > 0 ? ' has-spend' : ''}`}>
                  {spent > 0 ? formatMoney(spent, settings.currency, settings.language) : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="calendar-panel">
        <h2>{t('calendar.yearTotal')}</h2>
        <p className="big">{formatMoney(Object.values(totals).reduce((a, b) => a + b, 0), settings.currency, settings.language)}</p>
        <p className="empty">{t('calendar.dayPanelHint')}</p>
      </aside>
    </div>
  );
}
