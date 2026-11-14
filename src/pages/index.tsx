import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { periodSummary, monthlyTotals, totalsByCategory, type PeriodSummary, type CategoryTotal } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings, localeForLanguage } from '../core/settings';
import type { AppSettings } from '../core/settings';
import { DonutChart } from '../ui/components';
import { Transactions } from './Transactions';
import { Calendar } from './Calendar';
import { Salaries } from './Salaries';
import { Budgets } from './Budgets';
import { Goals } from './Goals';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PageTitle({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <h1 className="page-title">{t(titleKey)}</h1>;
}

export function Panel() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<(PeriodSummary & { categoryTotals: CategoryTotal[] }) | null>(null);
  const settings: AppSettings = loadSettings();
  const locale = localeForLanguage(settings.language);

  useEffect(() => {
    const now = new Date();
    const start = `${now.getFullYear()}-01-01`;
    const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    Promise.all([
      periodSummary(db, start, end),
      totalsByCategory(db, now.getFullYear(), now.getMonth() + 1),
    ]).then(([s, cats]) => setSummary({ ...s, categoryTotals: cats }));
  }, []);

  return (
    <div className="panel">
      <PageTitle titleKey="panel.title" />
      {summary && (
        <>
          {/* KPI tiles */}
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">{t('panel.totalSpent')}</div>
              <div className="kpi-value">{formatMoney(summary.totalSpentCents, settings.currency, locale)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('panel.income')}</div>
              <div className="kpi-value accent">{formatMoney(summary.incomeCents, settings.currency, locale)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('panel.savings')}</div>
              <div className="kpi-value positive">{formatMoney(summary.savingsCents, settings.currency, locale)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('panel.dailyAverage')}</div>
              <div className="kpi-value">{formatMoney(summary.avgPerDayCents, settings.currency, locale)}</div>
            </div>
          </div>

          {/* Salary / savings percentage strip */}
          <div className="metric-strip">
            <div className="metric">
              <span className="metric-label">{t('panel.salaryInPeriod')}</span>
              <span className="metric-value money">{formatMoney(summary.salaryCents, settings.currency, locale)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">{t('panel.savings')}</span>
              <span className="metric-value savings">{formatMoney(summary.savingsCents, settings.currency, locale)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">{t('panel.percentSpent')}</span>
              <span className="metric-value pct">{summary.pctSpent}%</span>
            </div>
            <div className="metric">
              <span className="metric-label">{t('panel.percentSavings')}</span>
              <span className="metric-value pct">{summary.pctSavings}%</span>
            </div>
          </div>

          {/* Categories: table + donut */}
          <div className="card">
            <h2 className="card-title">{t('panel.byCategory')}</h2>
            <div className="cat-panel">
              <div className="cat-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('panel.category')}</th>
                      <th className="num">{t('panel.totalSpent')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.categoryTotals.length === 0 ? (
                      <tr>
                        <td>{t('common.noData')}</td>
                        <td className="num">—</td>
                      </tr>
                    ) : (
                      summary.categoryTotals.map((c) => (
                        <tr key={c.categoryId}>
                          <td><span className="cat-dot" style={{ background: '#35c4dc' }} />{c.name}</td>
                          <td className="num">{formatMoney(c.totalCents, settings.currency, locale)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <DonutChart slices={summary.categoryTotals.filter((c) => c.totalCents > 0).map((c) => ({ label: c.name, value: c.totalCents, color: '#35c4dc' }))} />
            </div>
          </div>

          {/* Monthly bars */}
          <div className="card">
            <h2 className="card-title">{t('panel.monthly')}</h2>
            <MonthlyBars year={new Date().getFullYear()} locale={locale} currency={settings.currency} />
          </div>
        </>
      )}
    </div>
  );
}

function MonthlyBars({ year, locale, currency }: { year: number; locale: string; currency: string }) {
  const [months, setMonths] = useState<{ expense: number; income: number }[]>([]);
  useEffect(() => { monthlyTotals(db, year).then(setMonths); }, [year]);
  const max = Math.max(1, ...months.flatMap((m) => [m.expense, m.income]));
  return (
    <div className="bar-chart">
      {months.map((m, i) => (
        <div className="bar-col" key={i}>
          <div className="bar-stack">
            <div className="bar expense" style={{ height: `${(m.expense / max) * 150}px` }} title={`Despesas ${formatMoney(m.expense, currency, locale)}`} />
            <div className="bar income" style={{ height: `${(m.income / max) * 150}px` }} title={`Salário ${formatMoney(m.income, currency, locale)}`} />
          </div>
          <span className="bar-label">{MONTH_NAMES[i]}</span>
        </div>
      ))}
    </div>
  );
}

export { Transactions, Calendar, Salaries, Budgets, Goals };
