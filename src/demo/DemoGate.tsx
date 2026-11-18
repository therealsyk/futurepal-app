import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { DEMO_BLOCKED, DEMO_TAPS, askToDownload, resetDemo } from './demo';

// Limites da demonstração: páginas fora da demo e, depois de alguns toques, um convite para descarregar a app.
export function DemoGate() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'taps' | 'blocked'>('taps');

  // Páginas que não fazem parte da demonstração
  useEffect(() => {
    if (DEMO_BLOCKED.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      setReason('blocked'); setOpen(true);
      navigate('/', { replace: true });
    }
  }, [pathname, navigate]);

  // Conta os toques em botões e links; ao fim de DEMO_TAPS mostra o convite
  useEffect(() => {
    let taps = 0;
    const on = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest('button, a, [role="button"], input, select') || el.closest('.demo-gate')) return;
      taps++;
      if (taps >= DEMO_TAPS) { setReason('taps'); setOpen(true); }
    };
    document.addEventListener('click', on, true);
    return () => document.removeEventListener('click', on, true);
  }, []);

  if (!open) return null;
  return (
    <div className="demo-gate" role="dialog" aria-modal="true" aria-labelledby="demo-gate-title">
      <div className="demo-gate-card">
        <img src="./favicon.svg" alt="" width="56" height="56" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <h2 id="demo-gate-title">{reason === 'blocked' ? t('demo.blockedTitle') : t('demo.tapsTitle')}</h2>
        <p>{t('demo.text')}</p>
        <button type="button" className="fx-btn primary" onClick={askToDownload}>{t('demo.download')}</button>
        <button type="button" className="fx-btn" onClick={() => (reason === 'blocked' ? setOpen(false) : resetDemo(db))}>
          {reason === 'blocked' ? t('demo.keepExploring') : t('demo.restart')}
        </button>
      </div>
    </div>
  );
}
