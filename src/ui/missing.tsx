// Campos por preencher numa janela: ao confirmar, a janela abana, fica com contorno vermelho e cada campo em falta ganha um triângulo.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { L } from '../i18n/phrases';

/** [chave do campo, como se diz ("o valor"), está preenchido?] */
export type MissRule = [key: string, label: string, ok: boolean];

const SHAKE = [0, -2, 4, -8, 8, -8, 8, -8, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` }));

/** Abana a janela onde o elemento está (sem repetir a animação de entrada). */
function shakeSheet(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ block: 'nearest' });
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  el.closest('.fx-sheet, .bs-sheet')?.animate?.(SHAKE, { duration: 450, easing: 'cubic-bezier(.36,.07,.19,.97)' });
}

function MissNote({ n, text }: { n: number; text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { shakeSheet(ref.current); }, [n]);
  return <p ref={ref} className="sp-miss" role="alert"><span className="sp-miss-ic" aria-hidden="true">⚠</span><span>{L('Falta preencher')}: {text}</span></p>;
}

/** Outros avisos da janela (ex.: "já existe…"): também a fazem abanar. */
export function FormError({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { shakeSheet(ref.current); }, [text]);
  return <p ref={ref} className="sp-miss" role="alert"><span className="sp-miss-ic" aria-hidden="true">⚠</span><span>{text}</span></p>;
}

export interface Missing { check: () => boolean; cls: (key: string) => string; note: ReactNode; reset: () => void }

/** const missing = useMissing(); const miss = missing([['amount', L('o valor'), cents > 0]]);  — os avisos saem à medida que se preenche. */
export function useMissing(): (rules: MissRule[]) => Missing {
  const [n, setN] = useState(0);
  return (rules) => {
    const bad = rules.filter((r) => !r[2]);
    return {
      check: () => { if (bad.length) { setN((x) => x + 1); return false; } setN(0); return true; },
      cls: (key) => (n > 0 && bad.some((r) => r[0] === key) ? ' miss' : ''),
      note: n > 0 && bad.length > 0 ? <MissNote n={n} text={bad.map((r) => r[1]).join(', ')} /> : null,
      reset: () => setN(0),
    };
  };
}
