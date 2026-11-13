import { t } from 'i18next';

export function PageTitle({ titleKey }: { titleKey: string }) {
  return <h1 className="page-title">{t(titleKey)}</h1>;
}

export const Panel = () => <PageTitle titleKey="panel.title" />;
export const Calendar = () => <PageTitle titleKey="nav.calendar" />;
export const Transactions = () => <PageTitle titleKey="transactions.title" />;
export const Budgets = () => <PageTitle titleKey="nav.budgets" />;
export const Goals = () => <PageTitle titleKey="nav.goals" />;
export const Salaries = () => <PageTitle titleKey="nav.salaries" />;
export const Settings = () => <PageTitle titleKey="settings.title" />;
