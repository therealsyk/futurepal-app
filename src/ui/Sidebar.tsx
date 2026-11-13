import { NavLink } from 'react-router-dom';
import { t } from 'i18next';

const items = [
  { path: '/', key: 'nav.panel' },
  { path: '/calendario', key: 'nav.calendar' },
  { path: '/transacoes', key: 'nav.transactions' },
  { path: '/orcamentos', key: 'nav.budgets' },
  { path: '/metas', key: 'nav.goals' },
  { path: '/salarios', key: 'nav.salaries' },
  { path: '/definicoes', key: 'nav.settings' },
];

export default function Sidebar() {
  return (
    <nav className="sidebar" aria-label={t('common.appName')}>
      <div className="sidebar-brand">{t('common.appName')}</div>
      {items.map((it) => (
        <NavLink
          key={it.path}
          to={it.path}
          className={(props) => `sidebar-link${props.isActive ? ' active' : ''}`}
        >
          {t(it.key)}
        </NavLink>
      ))}
    </nav>
  );
}
