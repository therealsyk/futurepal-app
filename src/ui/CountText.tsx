// Número dentro de um texto já formatado (ex.: "€1.234,56", "12", "0,5") que rola até ao valor novo quando muda
// (mudar Mensal/Anual, filtrar datas…). Mantém o formato original: só os dígitos animam.
import { useEffect, useRef, useState } from 'react';
import { shouldRoll } from './rollGate';

const NUM = /-?\d[\d.,\u00a0\u202f ]*\d|-?\d/;
function parse(s: string): { n: number; dec: number; sep: string; grp: string } | null {
  const m = NUM.exec(s); if (!m) return null;
  const raw = m[0].replace(/[\u00a0\u202f ]/g, ' ');
  const lastSep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
  const dec = lastSep >= 0 && raw.length - lastSep - 1 <= 2 && raw.length - lastSep - 1 > 0 ? raw.length - lastSep - 1 : 0;
  const sep = dec ? raw[lastSep] : '';
  const grp = (raw.replace(sep ? raw.slice(lastSep) : '', '').match(/[.,\s]/) || [''])[0];
  const n = Number(raw.replace(/[\s.,]/g, (_c, i) => (i === lastSep && dec ? '.' : '')));
  return Number.isFinite(n) ? { n, dec, sep, grp } : null;
}
function fmt(n: number, p: { dec: number; sep: string; grp: string }): string {
  const neg = n < 0, a = Math.abs(n), int = Math.floor(a), frac = p.dec ? Math.round((a - int) * 10 ** p.dec).toString().padStart(p.dec, '0') : '';
  const i = p.grp ? String(int).replace(/\B(?=(\d{3})+(?!\d))/g, p.grp) : String(int);
  return (neg ? '-' : '') + i + (p.dec ? p.sep + frac : '');
}
export function CountText({ text }: { text: string }) {
  const zero = () => { const m = NUM.exec(text), p = parse(text); return m && p && shouldRoll() ? text.slice(0, m.index) + fmt(0, p) + text.slice(m.index + m[0].length) : text; };
  const [shown, setShownRaw] = useState(zero), last = useRef(shown);
  const setShown = (v: string) => { last.current = v; setShownRaw(v); }; // o que está à vista: é daí que a animação parte
  useEffect(() => {
    const from = parse(last.current), to = parse(text);
    if (!from || !to || from.n === to.n || !shouldRoll() || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.hidden) { setShown(text); return; }
    const m = NUM.exec(text)!; const pre = text.slice(0, m.index), post = text.slice(m.index + m[0].length);
    const t0 = performance.now(); let id = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 650), e = 1 - Math.pow(1 - k, 3); setShown(k < 1 ? pre + fmt(from.n + (to.n - from.n) * e, to) + post : text); if (k < 1) id = requestAnimationFrame(step); };
    id = requestAnimationFrame(step);
    const end = setTimeout(() => setShown(text), 900);
    return () => { cancelAnimationFrame(id); clearTimeout(end); };
  }, [text]);
  return <>{shown}</>;
}
