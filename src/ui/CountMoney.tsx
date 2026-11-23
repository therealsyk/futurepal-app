// Valor que "conta" até ao número certo quando aparece ou muda (sem animação para quem a desligou).
import { useEffect, useRef, useState } from 'react';
import { shouldRoll } from './rollGate';

export function CountMoney({ cents, money }: { cents: number; money: (c: number) => string }) {
  const [v, setVRaw] = useState(() => (shouldRoll() ? 0 : cents)), last = useRef(v);
  const setV = (x: number) => { last.current = x; setVRaw(x); }; // a animação parte sempre do valor à vista
  useEffect(() => {
    const from = last.current;
    if (from === cents || !shouldRoll() || document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(cents); return; }
    const t0 = performance.now(); let id = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 650), e = 1 - Math.pow(1 - k, 3); setV(Math.round(from + (cents - from) * e)); if (k < 1) id = requestAnimationFrame(step); };
    id = requestAnimationFrame(step);
    const end = setTimeout(() => setV(cents), 1000); // se a página ficar escondida a meio, fica o valor certo
    return () => { cancelAnimationFrame(id); clearTimeout(end); };
  }, [cents]);
  return <>{money(v)}</>;
}
