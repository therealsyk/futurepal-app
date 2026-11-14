import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const icon = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const items = [
  { path: '/', key: 'nav.panel', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { path: '/calendario', key: 'nav.calendar', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { path: '/transacoes', key: 'nav.transactions', icon: 'M4 7h16M4 12h16M4 17h10' },
  { path: '/orcamentos', key: 'nav.budgets', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: '/metas', key: 'nav.goals', icon: 'M22 11.08V12a10 10 0 1 1-5.914-5.914M22 11l-10 10' },
  { path: '/salarios', key: 'nav.salaries', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: '/definicoes', key: 'nav.settings', icon: 'M4 7h16M4 12h16M4 17h10' },
];

export default function Sidebar() {
  const { t } = useTranslation();
  return (
    <nav className="sidebar" aria-label={t('common.appName')}>
      <div className="sidebar-brand">{t('common.appName')}</div>
      {items.map((it) => (
        <NavLink
          key={it.path}
          to={it.path}
          className={(props) => `sidebar-link${props.isActive ? ' active' : ''}`}
        >
          <span className="sidebar-icon">{icon(it.icon)}</span>
          {t(it.key)}
        </NavLink>
      ))}
    </nav>
  );
}
