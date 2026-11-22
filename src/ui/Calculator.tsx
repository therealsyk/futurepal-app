// Calculadora da janela "Nova transação": botão na beira da janela, caixa que se arrasta e só fecha no X (ou com a janela).
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { evalCalc, OPS, pressCalc } from '../core/calc';
import { parseMoneyToCents } from '../core/money';
import { Ic, ICON } from './fx';
import { L } from '../i18n/phrases';

const KEYS: Array<[string, string, string?]> = [
  ['C', 'C', 'fn'], ['back', '⌫', 'fn'], ['%', '%', 'fn'], ['/', '÷', 'op'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['*', '×', 'op'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['-', '−', 'op'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op'],
  ['0', '0', 'zero'], ['.', ','], ['=', '=', 'eq'],
];
const GAP = 14;

export function CalculatorButton({ value, lang, onUse }: { value: string; lang: string; onUse: (amount: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className={'calc-btn' + (open ? ' on' : '')} aria-label={L('Calculadora')} title={L('Calculadora')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ic d="M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" size={20} />
      </button>
      {open && createPortal(<Panel value={value} lang={lang} onUse={onUse} onClose={() => setOpen(false)} sheet={() => ref.current?.closest('.fx-sheet') ?? null} />, document.body)}
    </>
  );
}

function Panel({ value, lang, onUse, onClose, sheet }: { value: string; lang: string; onUse: (amount: string) => void; onClose: () => void; sheet: () => Element | null }) {
  const box = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const moved = useRef(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [expr, setExpr] = useState(() => { const c = parseMoneyToCents(value); return c && c > 0 ? String(c / 100) : ''; });
  const [fresh, setFresh] = useState(true); // um número a seguir a "=" (ou ao valor inicial) começa uma conta nova

  const clamp = (x: number, y: number) => {
    const b = box.current!, top = document.documentElement.classList.contains('is-electron') ? 42 : 8;
    return { x: Math.max(8, Math.min(window.innerWidth - b.offsetWidth - 8, x)), y: Math.max(top, Math.min(window.innerHeight - b.offsetHeight - 8, y)) };
  };
  // agarrada ao lado direito da janela, alinhada em baixo; se for arrastada, fica onde a pessoa a deixou
  const dock = () => {
    const s = sheet()?.getBoundingClientRect(), b = box.current;
    if (!s || !b) return;
    const phone = window.innerWidth < 769;
    setPos(phone ? clamp((window.innerWidth - b.offsetWidth) / 2, s.top + 8) : clamp(s.right + GAP + 18, s.bottom - b.offsetHeight));
  };
  useLayoutEffect(dock, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const keep = () => { if (moved.current) setPos((p) => p && clamp(p.x, p.y)); else dock(); };
    const ro = new ResizeObserver(keep);
    const s = sheet();
    if (s) ro.observe(s);
    window.addEventListener('resize', keep);
    return () => { ro.disconnect(); window.removeEventListener('resize', keep); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // o foco só é possível depois de a caixa ficar visível
  const ready = pos !== null;
  useEffect(() => { if (ready) box.current?.focus({ preventScroll: true }); }, [ready]);

  const down = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button') || !pos) return;
    grab.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!grab.current) return;
    moved.current = true;
    setPos(clamp(e.clientX - grab.current.dx, e.clientY - grab.current.dy));
  };
  const up = () => { grab.current = null; };

  const dec = (1.1).toLocaleString(lang).includes(',') ? ',' : '.';
  const result = evalCalc(expr);
  const show = (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 4 });
  const pretty = expr.replace(/\./g, dec).replace(/[+\-*/]/g, (o, i: number) => (i === 0 ? '−' : ` ${({ '+': '+', '-': '−', '*': '×', '/': '÷' } as Record<string, string>)[o]} `));
  const isSum = /\d%?[+\-*/]/.test(expr) || expr.includes('%');

  const press = (k: string) => {
    if (k === 'C') { setExpr(''); setFresh(false); return; }
    if (k === 'back') { setExpr((x) => x.slice(0, -1)); setFresh(false); return; }
    if (k === '=') { if (result !== null) { setExpr(String(result)); setFresh(true); } return; }
    const restart = fresh && !OPS.includes(k) && k !== '%';
    setExpr((x) => pressCalc(restart ? '' : x, k));
    setFresh(false);
  };
  const usable = result !== null && Math.round(result * 100) > 0;
  const use = () => { if (usable) { onUse(result.toFixed(2).replace(/\.00$/, '').replace('.', dec)); setExpr(String(Math.round(result * 100) / 100)); setFresh(true); } };
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab') return;
    e.stopPropagation(); // o Esc fecha só a calculadora, não a janela
    if (e.key === 'Escape') { onClose(); return; }
    if ((e.target as HTMLElement).closest('button') && (e.key === 'Enter' || e.key === ' ')) return; // o botão focado trata disso
    const k = e.key === 'Enter' ? '=' : e.key === 'Backspace' ? 'back' : e.key === 'Delete' ? 'C' : e.key === ',' ? '.' : e.key === 'x' ? '*' : e.key;
    if (KEYS.some(([id]) => id === k)) { e.preventDefault(); press(k); }
  };

  return (
    <div ref={box} className="calc" role="dialog" aria-label={L('Calculadora')} tabIndex={-1} style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
      onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <header className="calc-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <b>{L('Calculadora')}</b>
        <button type="button" className="calc-x" onClick={onClose} aria-label={L('Fechar')}><Ic d={ICON.close} size={15} /></button>
      </header>
      <div className="calc-screen" aria-live="polite"><small>{isSum ? pretty : ''}</small><strong>{isSum ? (result === null ? '—' : show(result)) : pretty || '0'}</strong></div>
      <div className="calc-keys">
        {KEYS.map(([id, label, kind]) => (
          <button key={id} type="button" className={kind ?? ''} onClick={() => press(id)} aria-label={id === 'back' ? L('Apagar') : undefined}>{id === '.' ? dec : label}</button>
        ))}
      </div>
      <button type="button" className="calc-use" disabled={!usable} onClick={use}>{L('Usar este valor')}</button>
    </div>
  );
}
