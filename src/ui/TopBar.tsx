import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const items = [
  { path: '/', key: 'panel', icon: 'M3 12h4l3-7 4 10 3-5 4 6' },
  { path: '/transacoes', key: 'transactions', icon: 'M4 7h16M4 12h16M4 17h10' },
  { path: '/orcamentos', key: 'budgets', icon: 'M12 3v18M3 12l9-9 9 9M3 12l9 9 9-9' },
  { path: '/metas', key: 'goals', icon: 'M12 2a10 10 0 1 0 10 10M12 12l7-7' },
  { path: '/salarios', key: 'salaries', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { path: '/calendario', key: 'calendar', icon: 'M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
  { path: '/definicoes', key: 'settings', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 12h4M16 12h4' },
];

export default function TopBar() {
  const { t } = useTranslation();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">W</span>
        <span className="brand-name">Wallet</span>
      </div>
      <nav className="topnav" aria-label="Main">
        {items.map((it) => (
          <NavLink
            key={it.path}
            to={it.path}
            end={it.path === '/'}
            className={(props) => 'nav-pill' + (props.isActive ? ' active' : '')}
          >
            <span className="nav-icon">{icon(it.icon)}</span>
            {t(it.key)}
          </NavLink>
        ))}
      </nav>
      <div className="user-chip">
        <span>👤</span>
        <span>{t('panel.myWallet')}</span>
      </div>
    </header>
  );
}
