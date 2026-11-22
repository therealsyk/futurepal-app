import { PC_MOBILE } from '../core/uiMode';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadSettings, saveSettings, setTheme } from '../core/settings';
import type { AppSettings } from '../core/settings';
import logoUrl from '../assets/logo.svg';
import { useIsAdmin } from '../pages/Admin';

// Barra lateral de ícones. O nome de cada
// secção aparece como dica ao passar o rato ou ao focar com o teclado.

const svg = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ITEMS = [
  { path: '/', key: 'nav.panel', d: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' },
  { path: '/visao-mensal', key: 'nav.overview', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2M3 6l5-3 5 4 6-4' },
  { path: '/transacoes', key: 'nav.transactions', d: 'M4 7h13l-3-3M20 17H7l3 3' },
  { path: '/subscricoes', key: 'nav.recurring', d: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3' },
  { path: '/contas', key: 'nav.accounts', d: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16 14.5h.01' },
  { path: '/calendario', key: 'nav.calendar', d: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4' },
  { path: '/orcamentos', key: 'nav.budgets', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { path: '/metas', key: 'nav.goals', d: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z' },
  { path: '/grupos', key: 'simple.groups', d: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5' },
  { path: '/salarios', key: 'nav.salaries', d: 'M3 7h18v12H3zM3 11h18M7 15h3' },
  { path: '/categorias', key: 'nav.categories', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z' },
  { path: '/assistente', key: 'plus.short_assistant', d: 'M4 5h16v11H9l-5 4zM9 10h.01M12 10h.01M15 10h.01' },
];

const THEME_ORDER: AppSettings['theme'][] = ['dark', 'gray', 'light'];
const THEME_ICON: Record<AppSettings['theme'], string> = {
  dark: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  gray: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  light: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
};

export default function Rail() {
  const { t } = useTranslation();
  const [theme, setThemeState] = useState<AppSettings['theme']>(() => loadSettings().theme);

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    const s = loadSettings();
    saveSettings({ ...s, theme: next });
    setTheme(next);
    setThemeState(next);
  };

  const isAdmin = useIsAdmin();
  const themeLabel = `${t('nav.theme')}: ${t('nav.theme_' + theme)}`;

  return (
    <aside className="fx-rail">
      <img className="fx-logo-img" src={logoUrl} alt="" aria-hidden="true" />
      <nav aria-label={t('common.appName')}>
        {ITEMS.filter((it) => !(PC_MOBILE && it.path === '/visao-mensal')).map((it) => (
          <NavLink
            key={it.path}
            to={it.path}
            end={it.path === '/'}
            aria-label={t(it.key)}
            className={({ isActive }) => 'fx-rail-btn' + (isActive ? ' active' : '')}
          >
            {svg(it.d)}
            <span className="fx-tip">{t(it.key)}</span>
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink to="/admin" aria-label={t('admin.title')} className={({ isActive }) => 'fx-rail-btn' + (isActive ? ' active' : '')}>
            {svg('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4')}
            <span className="fx-tip">{t('admin.title')}</span>
          </NavLink>
        )}
      </nav>
      <div className="fx-rail-bottom">
        <button type="button" className="fx-rail-btn" onClick={cycleTheme} aria-label={themeLabel}>
          {svg(THEME_ICON[theme])}
          <span className="fx-tip">{themeLabel}</span>
        </button>
        <NavLink
          to="/definicoes"
          onClick={(e) => { if (PC_MOBILE) { e.preventDefault(); window.dispatchEvent(new Event('wallet:open-settings')); } }}
          aria-label={t('nav.settings')}
          className={({ isActive }) => 'fx-rail-btn' + (isActive ? ' active' : '')}
        >
          {svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z')}
          <span className="fx-tip">{t('nav.settings')}</span>
        </NavLink>
      </div>
    </aside>
  );
}
