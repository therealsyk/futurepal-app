import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { periodSummary } from '../core/finance';
import { formatMoney } from '../core/money';
import type { AppSettings } from '../core/settings';
import { OverviewGrid } from '../ui/components';
import { Transactions } from './Transactions';
import { Calendar } from './Calendar';
import { Salaries } from './Salaries';
import { Transactions, Calendar, Salaries } from './Transactions';


export function PageTitle({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <h1 className="page-title">{t(titleKey)}</h1>;
}

// SPEC §6.6 period -> [start, end] ISO dates relative to today.
function periodRange(period: string): [string, string] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (period === 'year') return [`${y}-01-01`, `${y}-12-31`];
  if (period === 'month') return [`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-31`];
  const days = period === '60' ? 60 : 30;
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  return [start.toISOString().slice(0, 10), now.toISOString().slice(0, 10)];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monthly income/expense totals for the bar chart (current year).
async function monthlyTotals(year: number) {
  const txs = await rangeTransactions(`${year}-01-01`, `${year}-12-31`);
  const months = Array.from({ length: 12 }, () => ({ expense: 0, income: 0 }));
  for (const tx of txs) {
    const m = Number(tx.date.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    if (tx.type === 'expense') months[m].expense += tx.amountCents;
    else months[m].income += tx.amountCents;
  }
  return months;
}

export function Panel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [period, setPeriod] = useState('month');
  const [summary, setSummary] = useState<{ totalSpent: number; income: number; net: number; dailyAvg: number; expenseCount: number; biggest: number; topCategoryName: string } | null>(null);
  const [salaryInfo, setSalaryInfo] = useState<{ salaryCents: number; extrasCents: number; savingsCents: number; pctSpent: number; pctSavings: number; monthsCovered: number; missingMonths: number } | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const [start, end] = periodRange(period);
    periodSummary(start, end, settings.mainCurrency).then(setSummary);
    db.salaries.where('year').equals(new Date().getFullYear()).toArray().then((rows) => {
      const salaryCents = rows.reduce((s, r) => s + r.amountCents, 0);
      const extrasCents = rows.reduce((s, r) => s + (r.extrasCents || 0), 0);
      setSalaryInfo({ salaryCents, extrasCents });
    });
  }, [settings, period]);

  useEffect(() => {
    if (!summary || !salaryInfo) return;
    const income = Math.max(summary.income, salaryInfo.salaryCents + salaryInfo.extrasCents);
    const savings = income - summary.totalSpent;
    const monthsCovered = Math.min(12, Math.max(0, Math.floor(income / (summary.totalSpent || 1))));
    setSummary((s) => ({ ...s!, income, net: savings }));
  }, [summary, salaryInfo]);

  return (
    <div>
      <PageTitle titleKey="panel.title" />

      <div className="tab-bar">
        {['month', '30', '60', '90', 'year'].map((p) => (
          <button key={p} className={`tab ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>
            {t(`panel.period${p}`)}
          </button>
        ))}
      </div>

      {!summary ? <p className="muted">…</p> : (
        <>
          {/* Hero KPI tiles */}
          <div className="kpi-row">
            <div className="kpi">
              <div className="kpi-label">{t('panel.totalSpent')}</div>
              <div className="kpi-value negative">{formatMoney(summary.totalSpent, settings?.mainCurrency)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('panel.income')}</div>
              <div className="kpi-value accent">{formatMoney(summary.income, settings?.mainCurrency)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('panel.savings')}</div>
              <div className="kpi-value positive">{formatMoney(summary.net, settings?.mainCurrency)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('panel.dailyAverage')}</div>
              <div className="kpi-value">{formatMoney(summary.dailyAvg, settings?.mainCurrency)}</div>
            </div>
          </div>

          {/* Salary / extras / savings strip */}
          {salaryInfo && (
            <div className="metric-strip">
              <div className="metric">
                <span className="metric-label">{t('panel.salaryInPeriod')}</span>
                <span className="metric-value money">{formatMoney(salaryInfo.salaryCents, settings?.mainCurrency)}</span>
              </div>
              <div className="metric">
                <span className="metric-label">Extras</span>
                <span className="metric-value extra">{formatMoney(salaryInfo.extrasCents, settings?.mainCurrency)}</span>
              </div>
              <div className="metric">
                <span className="metric-label">{t('panel.savings')}</span>
                <span className="metric-value savings">{formatMoney(summary.net, settings?.mainCurrency)}</span>
              </div>
              <div className="metric">
                <span className="metric-label">{t('panel.percentSpent')}</span>
                <span className="metric-value pct">{summary.income > 0 ? Math.round((summary.totalSpent / summary.income) * 100) : 0}%</span>
              </div>
              <div className="metric">
                <span className="metric-label">{t('panel.percentSavings')}</span>
                <span className="metric-value pct">{summary.income > 0 ? Math.round((summary.net / summary.income) * 100) : 0}%</span>
              </div>
            </div>
          )}

          <OverviewGrid summary={summary} currency={settings?.mainCurrency ?? 'EUR'} />

          {/* Categories: table + donut */}
          <div className="card">
            <h2 className="card-title">{t('panel.byCategory')}</h2>
            <div className="cat-panel">
              <div className="cat-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('common.add') === '' ? '' : 'Categoria'}</th>
                      <th className="num">{t('panel.totalSpent')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topCategoryName ? null : null}
                    <tr>
                      <td><span className="cat-dot" style={{ background: '#35c4dc' }} />{summary.topCategoryName || t('common.noData')}</td>
                      <td className="num">{formatMoney(summary.totalSpent, settings?.mainCurrency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <DonutChart />
            </div>
          </div>

          {/* Monthly bars */}
          <div className="card">
            <h2 className="card-title">{t('panel.monthly')}</h2>
            <MonthlyBars year={new Date().getFullYear()} />
          </div>
        </>
      )}
    </div>
  );
}

function MonthlyBars({ year }: { year: number }) {
  const [months, setMonths] = useState<{ expense: number; income: number }[]>([]);
  useEffect(() => { monthlyTotals(year).then(setMonths); }, [year]);
  const max = Math.max(1, ...months.flatMap((m) => [m.expense, m.income]));
  return (
    <div className="bar-chart">
      {months.map((m, i) => (
        <div className="bar-col" key={i}>
          <div className="bar-stack">
            <div className="bar expense" style={{ height: `${(m.expense / max) * 150}px` }} title={`Despesas ${formatMoney(m.expense, 'EUR')}`} />
            <div className="bar income" style={{ height: `${(m.income / max) * 150}px` }} title={`Salário ${formatMoney(m.income, 'EUR')}`} />
          </div>
          <span className="bar-label">{MONTH_NAMES[i]}</span>
        </div>
      ))}
    </div>
  );
}

export { Transactions, Calendar, Salaries };
export const Budgets = BudgetsPage;
export const Goals = GoalsPage;
