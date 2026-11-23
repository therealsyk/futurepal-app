// Telemóvel: a barra de cima (foto, nome, sino, menu e definições) acompanha a pessoa em todas as páginas
// e fica fixa ao deslizar. As janelas de adicionar (por cima) tapam-na, como é normal.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { UserAvatar } from './UserAvatar';
import { NotificationBell } from './AccountBar';
import { Ic } from './fx';
import { L } from '../i18n/phrases';

const GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z';

export function MobileTopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const meta = (auth.user?.user_metadata ?? {}) as { name?: string; full_name?: string };
  const name = meta.full_name || meta.name || auth.user?.email?.split('@')[0] || '';
  const [up, setUp] = useState(false); // já deslizou: a barra passa a cartão flutuante
  useEffect(() => { const on = (e?: Event) => { const el = e?.target instanceof Element ? e.target : null; if (el && el.closest('.bs-sheet, .fx-sheet, .ab-pop, .nt-list')) return; setUp((el ? el.scrollTop : 0) > 8 || window.scrollY > 8 || (document.scrollingElement?.scrollTop ?? 0) > 8); }; on(); window.addEventListener('scroll', on, { passive: true, capture: true }); return () => window.removeEventListener('scroll', on, { capture: true }); }, []);
  return (
    <header className={'mv-head mtb' + (up ? ' up' : '')}>
      <button type="button" className="mv-hello mtb-hello" onClick={() => navigate('/')} aria-label={L('Início')}>
        <UserAvatar user={auth.user} name={name || '?'} className="ab-initials mv-avatar" />
        <div className="mv-hello-txt">{name && <small>{L('Olá,')}</small>}<h1 style={{ fontSize: Math.max(13, Math.min(20, Math.floor(100 / ((name.split(' ')[0].length + 1) * 0.58)))) }}>{name ? name.split(' ')[0] + '!' : L('Olá!')}</h1></div>
      </button>
      <NotificationBell />
      <button type="button" className="mv-sq mv-menu" data-tour="menu" onClick={() => window.dispatchEvent(new Event('wallet:open-more'))} aria-label={L('Mais funções')}><Ic d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" size={19} /><span>{L('Menu')}</span></button>
      <button type="button" className="mv-sq" data-tour="settings" onClick={() => navigate('/definicoes')} aria-label={t('nav.settings')}><Ic d={GEAR} size={20} /></button>
    </header>
  );
}
