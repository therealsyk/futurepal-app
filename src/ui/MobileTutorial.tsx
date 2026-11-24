import { tipsOff } from '../core/onboarding';
import { showWelcome } from './WelcomeSplash';
import { L } from '../i18n/phrases';
import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Visita guiada do telemóvel: depois do setup, escurece o ecrã e ilumina, um a um, os botões e
// zonas reais do Início, com uma explicação ao lado. Reabre-se no botão "?" do Início.
// Cada passo aponta para um elemento com data-tour="…" (sem alvo = cartão ao centro).
export const TUTORIAL_KEY = 'wallet.tutorialSeen';
export const TUTORIAL_EVENT = 'wallet:tutorial';
export const openTutorial = () => window.dispatchEvent(new Event(TUTORIAL_EVENT));

const STEPS: Array<{ target?: string; title: string; text: string }> = [
  { title: 'Vamos dar uma volta rápida', text: 'Mostramos-te onde está cada coisa. Leva menos de um minuto.' },
  { target: 'month', title: 'O dinheiro deste mês', text: 'O número grande é o que ainda tens para gastar.' },
  { target: 'quick', title: 'Gastaste ou recebeste?', text: 'Toca em Gastei ou em Recebi, escreve o valor e já está.' },
  { target: 'import', title: 'Importar extrato do banco', text: 'Tens muitas despesas? Importa o extrato do banco aqui e entram todas de uma vez. Também está em Definições › Dados.' },
  { target: 'accounts', title: 'As tuas contas', text: 'Aqui vês quanto tens em cada conta.' },
  { target: 'tx', title: 'Transações', text: 'A lista de tudo o que gastaste e recebeste.' },
  { target: 'limits', title: 'Limites', text: 'Escolhe quanto queres gastar no máximo em cada coisa, por exemplo no supermercado.' },
  { target: 'bell', title: 'Avisos', text: 'No sino recebes avisos: pagamentos a chegar, limites, metas e o planeamento de cada mês novo.' },
  { title: 'Planeia o próximo mês', text: 'Em Menu › Planeamento vês se o próximo mês fecha bem, o que pesa mais e o que podes fazer. Também podes simular uma compra antes de a fazer.' },
  { target: 'menu', title: 'Menu', text: 'As metas, o resumo, o calendário, os salários e tudo o resto estão aqui.' },
  { target: 'settings', title: 'Precisas de ajuda?', text: 'Nas Definições podes voltar a ver esta visita quando quiseres.' },
];
const PAD = 8;

function seen(): boolean {
  try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return true; }
}

export function MobileTutorial({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(() => enabled && !seen());
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];

  useEffect(() => {
    const on = () => { setI(0); setOpen(true); };
    window.addEventListener(TUTORIAL_EVENT, on);
    return () => window.removeEventListener(TUTORIAL_EVENT, on);
  }, []);

  // A visita acontece no Início.
  useEffect(() => { if (open && enabled && pathname !== '/') navigate('/'); }, [open, enabled, pathname, navigate]);

  const measure = useCallback(() => {
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step.target]);

  // Leva o elemento para o centro do ecrã e mede-o depois do scroll.
  useLayoutEffect(() => {
    if (!open || !enabled) return;
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    const fixed = el && getComputedStyle(el.closest('.mb-tabbar') ?? el).position === 'fixed';
    if (el && !fixed) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    measure();
    const id = window.setTimeout(measure, 420);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.clearTimeout(id); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, enabled, i, pathname, measure, step.target]);

  if (!open || !enabled) return null;
  const close = () => { try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* sem storage */ } setOpen(false); window.scrollTo({ top: 0 }); showWelcome(); };
  const last = i === STEPS.length - 1;

  // Balão por baixo do alvo se este estiver na metade de cima; senão por cima.
  const vh = window.innerHeight;
  const below = rect ? rect.top + rect.height / 2 < vh / 2 : false;
  const bubbleStyle: CSSProperties = !rect ? {}
    : below ? { top: Math.min(rect.bottom + PAD + 12, vh - 220) } : { bottom: Math.max(vh - rect.top + PAD + 12, 12) };

  return (
    <div className="tu-layer" role="dialog" aria-modal="true" aria-label={t('tutorial.title')}>
      {rect
        ? <div className="tu-spot" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
        : <div className="tu-dim" />}
      <div className={'tu-bubble' + (rect ? '' : ' center')} style={bubbleStyle} key={step.title}>
        <div className="tu-top">
          <small>{t('tutorial.stepOf', { n: i + 1, total: STEPS.length })}</small>
          {!last && <button type="button" className="tu-skip" onClick={close}>{t('tutorial.skip')}</button>}
        </div>
        <h2>{L(step.title)}</h2>
        <p>{L(step.text)}</p>
        <div className="tu-actions">
          <div className="tu-dots" aria-hidden="true">{STEPS.map((x, k) => <i key={x.title} className={k === i ? 'on' : ''} />)}</div>
          {i > 0 && <button type="button" className="tu-btn ghost" onClick={() => setI(i - 1)}>{t('tutorial.back')}</button>}
          <button type="button" className="tu-btn" onClick={() => { if (last) { tipsOff(); close(); } else setI(i + 1); }} data-testid="tu-next">
            {last ? t('tutorial.start') : t('tutorial.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
