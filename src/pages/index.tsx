import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { monthSummary, totalsByCategory } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings, type AppSettings } from '../core/settings';
import { OverviewGrid, CategoryRow } from '../ui/components';

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
      <OverviewGrid
        tiles={[
          { label: t('panel.income'), value: formatMoney(summary.incomeCents, s.currency, s.language) },
          { label: t('panel.totalSpent'), value: formatMoney(summary.expenseCents, s.currency, s.language), tone: 'negative' },
          { label: t('panel.net'), value: formatMoney(summary.netCents, s.currency, s.language), tone: summary.netCents >= 0 ? 'positive' : 'negative' },
        ]}
      />
      {cats.length > 0 && (
        <div className="overview-grid">
          {cats.map((c) => (
            <CategoryRow
              key={c.categoryId}
              name={catLabel(c)}
              left={formatMoney(c.totalCents, s.currency, s.language)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
export const Calendar = () => <PageTitle titleKey="nav.calendar" />;
import { Transactions } from './Transactions';
export { Transactions };
export const Budgets = () => <PageTitle titleKey="nav.budgets" />;
export const Goals = () => <PageTitle titleKey="nav.goals" />;
export const Salaries = () => <PageTitle titleKey="nav.salaries" />;

