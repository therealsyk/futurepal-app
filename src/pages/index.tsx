export function PageTitle({ title }: { title: string }) {
  return <h1 className="page-title">{title}</h1>;
}

export const Panel = () => <PageTitle title="Painel (em breve)" />;
export const Calendar = () => <PageTitle title="Calendário (em breve)" />;
export const Transactions = () => <PageTitle title="Transações (em breve)" />;
export const Budgets = () => <PageTitle title="Orçamentos (em breve)" />;
export const Goals = () => <PageTitle title="Metas (em breve)" />;
export const Salaries = () => <PageTitle title="Salários (em breve)" />;
export const Settings = () => <PageTitle title="Definições (em breve)" />;
