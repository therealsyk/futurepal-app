import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { dailyTotals, transactionsOnDay, expandRecurring } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';

// SPEC §6.5: grid by day with amount spent per day; clicking a day shows the
// expense list for that day in a side panel.
export const Calendar = () => {
  const { t } = useTranslation();
  const s = loadSettings();
  const [year, setYear] = useState(new Date().getFullYear());
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayTx, setDayTx] = useState<any[]>([]);
  // SPEC §6.9: projected recurring entries for the selected year (not yet
  // saved as transactions — shown with a "recurring" badge).
  const [recurringDays, setRecurringDays] = useState<Record<string, any[]>>({});

  useEffect(() => {
    dailyTotals(db, year).then(setTotals).catch(() => setTotals({}));
  }, [year]);

  useEffect(() => {
    const until = `${year}-12-31`;
    expandRecurring(db, until)
      .then((items) => {
        const map: Record<string, any[]> = {};
        for (const r of items) {
          if (r.date.slice(0, 4) !== String(year)) continue;
          (map[r.date] ??= []).push(r);
        }
        setRecurringDays(map);
      })
      .catch(() => setRecurringDays({}));
  }, [year]);

  useEffect(() => {
    if (!selectedDay) return;
    transactionsOnDay(db, selectedDay)
      .then((txs) => setDayTx(txs.filter((x) => x.type === 'expense')))
      .catch(() => setDayTx([]));
  }, [selectedDay]);

  const fmt = (cents: number) => formatMoney(cents, s.currency, s.language);

  // Build all days of the year sorted by date.
  const days: string[] = [];
  const d = new Date(year, 0, 1);
  while (d.getFullYear() === year) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  return (
    <div>
      <h1 className="page-title">{t('calendar.title')}</h1>
      <div className="stat-row">
        <label htmlFor="cal-year">{t('salaries.yearLabel')}</label>
        <input id="cal-year" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </div>

      <div className="calendar-grid" role="grid">
        {days.map((date) => (
          <button
            key={date}
            type="button"
            data-testid={`day-${date}`}
            className={`calendar-day${selectedDay === date ? ' active' : ''}`}
            onClick={() => setSelectedDay(date)}
          >
            <span className="calendar-date">{date.slice(8)}</span>
            {totals[date] > 0 && <span className="calendar-amount">{fmt(totals[date])}</span>}
            {recurringDays[date]?.length > 0 && (
              <span className="calendar-recurring" title={t('calendar.recurringUpcoming')}>↻</span>
            )}
          </button>
        ))}
      </div>

      {selectedDay && (
        <aside className="calendar-panel">
          <h2>{t('calendar.dayPanel')}</h2>
          {dayTx.length === 0 && !recurringDays[selectedDay]?.length ? (
            <p>{t('calendar.noExpenses')}</p>
          ) : (
            <ul>
              {dayTx.map((tx) => (
                <li key={tx.id}>
                  {tx.description} — {fmt(tx.amountCents)}
                </li>
              ))}
              {(recurringDays[selectedDay] ?? []).map((r, i) => (
                <li key={`rec-${i}`} className="calendar-recurring-item">
                  {r.description} — {fmt(r.amountCents)} ({t('calendar.recurringUpcoming')})
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
};
