import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { monthSummary, totalsByCategory } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings, type AppSettings } from '../core/settings';

export function PageTitle({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <h1 className="page-title">{t(titleKey)}</h1>;
}

export const Panel = ({ settings }: { settings?: AppSettings }) => {
  const { t } = useTranslation();
  const s = settings ?? loadSettings();
  const now = new Date();
  const [summary, setSummary] = useState({ incomeCents: 0, expenseCents: 0, netCents: 0 });
  const [cats, setCats] = useState<{ categoryId: string; nameKey?: string; name: string; totalCents: number }[]>([]);

  useEffect(() => {
    monthSummary(db, now.getFullYear(), now.getMonth() + 1).then(setSummary);
    totalsByCategory(db, now.getFullYear(), now.getMonth() + 1)
      .then((rows) => setCats(rows.filter((r) => r.totalCents !== 0)))
      .catch(() => setCats([]));
  }, []);

  const catLabel = (c: { name: string; nameKey?: string }) => (c.nameKey ? t(c.nameKey) : c.name);

  return (
    <div>
      <PageTitle titleKey="panel.title" />
      <div className="panel-summary">
        <p>{t('panel.income')}: {formatMoney(summary.incomeCents, s.currency, s.language)}</p>
        <p>{t('panel.totalSpent')}: {formatMoney(summary.expenseCents, s.currency, s.language)}</p>
        <p>{t('panel.net')}: {formatMoney(summary.netCents, s.currency, s.language)}</p>
      </div>
      {cats.length > 0 && (
        <ul className="panel-cats">
          {cats.map((c) => (
            <li key={c.categoryId}>
              {catLabel(c)}: {formatMoney(c.totalCents, s.currency, s.language)}
            </li>
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

