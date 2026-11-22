import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SIMPLE_UI } from '../core/uiMode';
import { Ic, ICON } from './fx';
import { L } from '../i18n/phrases';

// Navegação do telemóvel (só aparece em ecrãs estreitos, ver mobile.css):
// barra flutuante em baixo com o botão "+" (nova transação) ao centro e folha "Mais" com o resto.

const TABS = [
  { path: '/', key: 'mobile.home', d: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10' },
  { path: '/metas', key: 'nav.goals', d: 'M12 21a9 9 0 1 1 0-18M12 16a4 4 0 1 1 0-8M12 12l8-8M16 4h4v4' },
  { path: '/contas', key: 'nav.accounts', d: ICON.wallet },
];

// Modo simples (pré-visualização): menos separadores e só o essencial no "Mais"
const SIMPLE_TABS = [
  TABS[0],
  { path: '/transacoes', key: 'nav.transactions', d: 'M4 7h13l-3-3M20 17H7l3 3' },
  { path: '/orcamentos', key: 'simple.tabLimits', d: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z' },
  { path: '/contas', key: 'nav.accounts', d: ICON.wallet },
];
const SIMPLE_MORE = ['/visao-mensal', '/subscricoes', '/categorias', '/ajuda'];
// já estão nos separadores, no Início ou no ⚙ — não se repetem em "Ver todas"
const SIMPLE_HIDE = ['/transacoes', '/orcamentos', '/definicoes'];
const MORE = [
  { path: '/metas', key: 'nav.goals', d: 'M12 21a9 9 0 1 1 0-18M12 16a4 4 0 1 1 0-8M12 12l8-8M16 4h4v4' },
  { path: '/grupos', key: 'simple.groups', d: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5' },
  { path: '/plus', key: 'nav.plus', d: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z' },
  { path: '/orcamentos', key: 'nav.budgets', d: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z' },
  ...(SIMPLE_UI ? [] : [{ path: '/painel', key: 'mobile.fullPanel', d: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' }]),
  { path: '/transacoes', key: 'nav.transactions', d: 'M4 7h13l-3-3M20 17H7l3 3' },
  { path: '/subscricoes', key: 'nav.recurring', d: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3' },
  { path: '/visao-mensal', key: 'nav.overview', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { path: '/calendario', key: 'nav.calendar', d: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4' },
  { path: '/salarios', key: 'nav.salaries', d: 'M3 7h18v12H3zM3 11h18M7 15h3' },
  { path: '/categorias', key: 'nav.categories', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z' },
  { path: '/assistente', key: 'plus.short_assistant', d: 'M4 5h16v11H9l-5 4zM9 10h.01M12 10h.01M15 10h.01' },
  { path: '/ajuda', key: 'nav.help', d: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01' },
  { path: '/definicoes', key: 'nav.settings', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z' },
];

export default function MobileNav() {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  const [all, setAll] = useState(false);
  const tabs = SIMPLE_UI ? SIMPLE_TABS : TABS;
  const moreItems = MORE.filter((m) => (SIMPLE_UI ? (all ? !SIMPLE_HIDE.includes(m.path) : SIMPLE_MORE.includes(m.path)) : m.path !== '/metas' && m.path !== '/grupos'));
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inMore = MORE.some((m) => pathname.startsWith(m.path));
  useEffect(() => { const on = (e: Event) => { setMore(true); if ((e as CustomEvent).detail !== undefined) setAll((e as CustomEvent).detail === 'all'); }, off = () => { setMore(false); setAll(false); }; window.addEventListener('wallet:open-more', on); window.addEventListener('wallet:close-more', off); return () => { window.removeEventListener('wallet:open-more', on); window.removeEventListener('wallet:close-more', off); }; }, []);
  const go = (p: string) => { setMore(false); setAll(false); navigate(p); };

  return (
    <>
      <nav className="mb-tabbar" aria-label={t('common.appName')}>
        {tabs.map((it, i) => (
          <span key={it.path} style={{ display: 'contents' }}>
            {i === (SIMPLE_UI ? 2 : 2) && (
              <button type="button" className="mb-plus" onClick={() => navigate('/transacoes?nova=1')} aria-label={t('transactions.addTransaction')} data-testid="mb-fab" data-tour="add">
                <Ic d={ICON.plus} size={26} />
              </button>
            )}
            <NavLink to={it.path} end={it.path === '/'} data-tour={it.path === '/transacoes' ? 'tx' : it.path === '/orcamentos' ? 'limits' : undefined} className={({ isActive }) => 'mb-tab' + (isActive ? ' active' : '')}>
              <Ic d={it.d} size={22} />
              <span>{t(it.key)}</span>
            </NavLink>
          </span>
        ))}
        {!SIMPLE_UI && <button type="button" className={'mb-tab' + (inMore || more ? ' active' : '')} onClick={() => setMore(true)} aria-haspopup="dialog" data-testid="mb-more" data-tour="more">
          <Ic d="M5 12h.01M12 12h.01M19 12h.01" size={22} />
          <span>{t('mobile.more')}</span>
        </button>}
      </nav>

      {more && (
        <div className="mb-backdrop" onClick={() => setMore(false)}>
          <div className="mb-sheet" role="dialog" aria-modal="true" aria-label={t('mobile.more')} onClick={(e) => e.stopPropagation()}>
            <span className="mb-grabber" aria-hidden="true" />
            <div className="mb-grid">
              {moreItems.map((it) => (
                <button key={it.path} type="button" data-go={it.path} className={'mb-tile' + (pathname.startsWith(it.path) || (it.path === '/visao-mensal' && pathname === '/resumo-ano') ? ' active' : '')} onClick={() => go(it.path)}>
                  <span><Ic d={it.d} size={20} /></span>
                  <b>{SIMPLE_UI && it.path === '/visao-mensal' ? L('Resumo') : t(it.key)}</b>
                </button>
              ))}
            </div>
            {SIMPLE_UI && !all && <button type="button" className="mb-allbtn" onClick={() => setAll(true)}>{t('simple.allFeatures')}</button>}
          </div>
        </div>
      )}
    </>
  );
}
