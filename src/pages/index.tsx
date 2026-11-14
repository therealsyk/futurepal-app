import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { periodSummary, rangeTransactions } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings, type AppSettings } from '../core/settings';
import { OverviewGrid, CategoryRow, DonutChart } from '../ui/components';

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
  const days = period === '60' ? 60 : period === '90' ? 90 : 30;
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  return [start.toISOString().slice(0, 10), now.toISOString().slice(0, 10)];
}

export const Panel = ({ settings }: { settings?: AppSettings }) => {
  const { t } = useTranslation();
  const s = settings ?? loadSettings();
  const [period, setPeriod] = useState('month');
  const [summary, setSummary] = useState<any>(null);
  const [cats, setCats] = useState<{ name: string; totalCents: number }[]>([]);

  useEffect(() => {
    const [start, end] = periodRange(period);
    periodSummary(db, start, end).then(setSummary).catch(() => setSummary(null));
    // category breakdown for donut (expenses only)
    rangeTransactions(db, start, end)
      .then((txs) => {
        const map = new Map<string, number>();
        for (const tx of txs.filter((x) => x.type === 'expense' && x.amountCents > 0)) {
          map.set(tx.categoryId, (map.get(tx.categoryId) || 0) + tx.amountCents);
        }
        return Promise.all([...map.entries()].map(async ([id, total]) => {
          const c = await db.categories.get(id);
          return { name: c ? c.name : id, totalCents: total };
        }));
      })
      .then((rows) => setCats(rows))
      .catch(() => setCats([]));
  }, [period]);

  const fmt = (cents: number) => formatMoney(cents, s.currency, s.language);

  return (
    <div>
      <PageTitle titleKey="panel.title" />
      <div className="tab-bar" role="tablist">
        {[['month', 'panel.periodMonth'], ['year', 'panel.periodYear'], ['30', 'panel.period30'], ['60', 'panel.period60'], ['90', 'panel.period90']].map(([k, key]) => (
          <button key={k} type="button" role="tab" aria-selected={period === k} className={`tab${period === k ? ' active' : ''}`} onClick={() => setPeriod(k)}>
            {t(key)}
          </button>
        ))}
      </div>
      {summary && (
        <>
          <OverviewGrid
            tiles={[
              { label: t('panel.income'), value: fmt(summary.incomeCents) },
              { label: t('panel.totalSpent'), value: fmt(summary.totalSpentCents), tone: 'negative' },
              { label: t('panel.net'), value: fmt(summary.savingsCents), tone: summary.savingsCents >= 0 ? 'positive' : 'negative' },
            ]}
          />
          <OverviewGrid
            tiles={[
              { label: t('panel.dailyAverage'), value: fmt(summary.avgPerDayCents) },
              { label: t('panel.expenseCount'), value: String(summary.expenseCount) },
              { label: t('panel.biggestExpense'), value: fmt(summary.maxExpenseCents) },
              { label: t('panel.topCategory'), value: summary.topCategory ? `${summary.topCategory.name} — ${fmt(summary.topCategory.totalCents)}` : '' },
            ]}
          />
          <OverviewGrid
            tiles={[
              { label: t('panel.salaryInPeriod'), value: fmt(summary.salaryCents) },
              { label: t('panel.percentSpent'), value: (summary.pctSpent * 100).toFixed(1) + '%' },
              { label: t('panel.percentSavings'), value: (summary.pctSavings * 100).toFixed(1) + '%' },
              { label: t('panel.savingsPerMonth'), value: fmt(summary.avgMonthlySavingsCents) },
            ]}
          />
          {summary.missingSalaryMonths.length > 0 && <p className="stat-label">{t('panel.missingSalaryWarning')}</p>}
          {cats.length > 0 && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
              <DonutChart slices={cats.map((c) => ({ label: c.name, value: c.totalCents, color: '#2DD4BF' }))} />
              <div className="overview-grid">
                {cats.map((c, i) => (
                  <CategoryRow key={i} name={c.name} left={fmt(c.totalCents)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
import { Calendar } from './Calendar';
import { Salaries } from './Salaries';
import { Transactions } from './Transactions';
export { Transactions, Calendar, Salaries };
export const Budgets = () => <PageTitle titleKey="nav.budgets" />;
export const Goals = () => <PageTitle titleKey="nav.goals" />;

