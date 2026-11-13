import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { monthSummary, totalsByCategory } from '../core/finance';

export function PageTitle({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <h1 className="page-title">{t(titleKey)}</h1>;
}

export const Panel = () => {
  const { t } = useTranslation();
  const now = new Date();
  const [summary, setSummary] = useState({ income: 0, expenses: 0, net: 0 });
  const [cats, setCats] = useState<{ name: string; total: number }[]>([]);

  useEffect(() => {
    monthSummary(db, now.getFullYear(), now.getMonth() + 1).then(setSummary);
    totalsByCategory(db, now.getFullYear(), now.getMonth() + 1)
      .then((rows) => setCats(rows.filter((r) => r.total !== 0)))
      .catch(() => setCats([]));
  }, []);

  return (
    <div>
      <PageTitle titleKey="panel.title" />
      <div className="panel-summary">
        <p>{t('panel.income')}: {summary.income}</p>
        <p>{t('panel.totalSpent')}: {summary.expenses}</p>
        <p>{t('panel.savings')}: {summary.net}</p>
      </div>
      {cats.length > 0 && (
        <ul className="panel-cats">
          {cats.map((c) => (
            <li key={c.name}>{c.name}: {c.total}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
export const Calendar = () => <PageTitle titleKey="nav.calendar" />;
export const Transactions = () => <PageTitle titleKey="transactions.title" />;
export const Budgets = () => <PageTitle titleKey="nav.budgets" />;
export const Goals = () => <PageTitle titleKey="nav.goals" />;
export const Salaries = () => <PageTitle titleKey="nav.salaries" />;

