import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Visita guiada do telemóvel: depois do setup, escurece o ecrã e ilumina, um a um, os botões e
// zonas reais do Início, com uma explicação ao lado. Reabre-se no botão "?" do Início.
// Cada passo aponta para um elemento com data-tour="…" (sem alvo = cartão ao centro).
export const TUTORIAL_KEY = 'wallet.tutorialSeen';
export const TUTORIAL_EVENT = 'wallet:tutorial';
export const openTutorial = () => window.dispatchEvent(new Event(TUTORIAL_EVENT));

const STEPS: Array<{ id: string; target?: string }> = [
  { id: 'welcome' },
  { id: 'month', target: 'month' },
  { id: 'add', target: 'add' },
  { id: 'quick', target: 'quick' },
  { id: 'map', target: 'map' },
  { id: 'accounts', target: 'accounts' },
  { id: 'goals', target: 'goals' },
  { id: 'more', target: 'more' },
  { id: 'help', target: 'help' },
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
  const close = () => { try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* sem storage */ } setOpen(false); window.scrollTo({ top: 0 }); };
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
      <div className={'tu-bubble' + (rect ? '' : ' center')} style={bubbleStyle} key={step.id}>
        <div className="tu-top">
          <small>{t('tutorial.stepOf', { n: i + 1, total: STEPS.length })}</small>
          {!last && <button type="button" className="tu-skip" onClick={close}>{t('tutorial.skip')}</button>}
        </div>
        <h2>{t(`tutorial.${step.id}Title`)}</h2>
        <p>{t(`tutorial.${step.id}Text`)}</p>
        <div className="tu-actions">
          <div className="tu-dots" aria-hidden="true">{STEPS.map((x, k) => <i key={x.id} className={k === i ? 'on' : ''} />)}</div>
          {i > 0 && <button type="button" className="tu-btn ghost" onClick={() => setI(i - 1)}>{t('tutorial.back')}</button>}
          <button type="button" className="tu-btn" onClick={() => (last ? close() : setI(i + 1))} data-testid="tu-next">
            {last ? t('tutorial.start') : t('tutorial.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
