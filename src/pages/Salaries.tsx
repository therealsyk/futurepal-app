import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { salaryGrid, salaryYearSummary, setSalary } from '../core/finance';
import { parseMoneyToCents, formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';

// SPEC §6.4: grid of months x year with the salary for each month + "extras"
// (complementary income). Each cell holds a value; totals shown per month/year.
export const Salaries = () => {
  const { t } = useTranslation();
  const s = loadSettings();
  const [year, setYear] = useState(new Date().getFullYear());
  const [grid, setGrid] = useState<Array<{ month: number; amountCents: number }>>([]);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    salaryGrid(db, year).then(setGrid).catch(() => setGrid([]));
    salaryYearSummary(db, year).then(setSummary).catch(() => setSummary(null));
  }, [year]);

  const fmt = (cents: number) => formatMoney(cents, s.currency, s.language);

  return (
    <div>
      <h1 className="page-title">{t('salaries.title')}</h1>
      <div className="stat-row">
        <label htmlFor="salary-year">{t('salaries.yearLabel')}</label>
        <input id="salary-year" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </div>

      <div className="salary-grid">
        {grid.map((row) => (
          <div key={row.month} className="salary-cell">
            <span>{t('salaries.salaryFor')} {(t('calendar.monthNames', { returnObjects: true }) as string[])[row.month - 1]}</span>
            <input
              type="text"
              value={fmt(row.amountCents)}
              onChange={(e) => {
                const cents = parseMoneyToCents(e.target.value);
                if (cents !== null) setSalary(db, year, row.month, cents);
              }}
            />
          </div>
        ))}
      </div>

      {summary && (
        <div className="overview-grid">
          <div className="stat-tile">
            <span className="stat-label">{t('salaries.annualSalaries')}</span>
            <span className="stat-value">{fmt(summary.salaryCents)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
