// Grelha de widgets do Resumo: a editar, arrasta-se para qualquer sítio e puxa-se por qualquer lado ou canto para mudar o tamanho.
// O conteúdo adapta-se ao tamanho com "container queries" (.pco-cell em pc-mobile.css).
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { COLS, MIN_H, MIN_W, moveCell, resizeCell, rowsOf, SCREEN_ROWS, type Cell } from '../core/widgetGrid';
import { L } from '../i18n/phrases';

const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Dir = typeof DIRS[number] | 'move';
interface Act { id: string; dir: Dir; px: number; py: number; scroll: number; base: Cell[]; from: Cell; live: { left: number; top: number; width: number; height: number } }

export function FreeGrid({ cells, editing, names, render, onChange, onRemove }: {
  cells: Cell[]; editing: boolean; names: (id: string) => string; render: (id: string) => ReactNode;
  onChange: (cells: Cell[]) => void; onRemove: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [act, setAct] = useState<Act | null>(null);
  const [view, setView] = useState<Cell[] | null>(null); // como fica se largar agora
  useLayoutEffect(() => {
    const el = box.current!;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const flow = size.w > 0 && size.w < 700; // janela estreita: um por baixo do outro
  const ux = size.w / COLS, uy = Math.max(26, size.h / SCREEN_ROWS);
  const shown = view ?? cells;
  const rect = (c: Cell) => ({ left: c.x * ux, top: c.y * uy, width: c.w * ux, height: c.h * uy });

  const start = (id: string, dir: Dir) => (e: PointerEvent<HTMLElement>) => {
    if (!editing || flow || e.button !== 0 || (dir === 'move' && (e.target as HTMLElement).closest('button'))) return;
    e.preventDefault(); e.stopPropagation();
    const from = cells.find((c) => c.id === id)!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setAct({ id, dir, px: e.clientX, py: e.clientY, scroll: box.current!.scrollTop, base: cells, from, live: rect(from) });
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!act) return;
    const el = box.current!, r = el.getBoundingClientRect();
    if (e.clientY > r.bottom - 50) el.scrollTop += 14; else if (e.clientY < r.top + 40) el.scrollTop -= 14;
    const dx = e.clientX - act.px, dy = e.clientY - act.py + el.scrollTop - act.scroll;
    const f = rect(act.from), live = { ...f };
    if (act.dir === 'move') { live.left = Math.max(0, Math.min(size.w - f.width, f.left + dx)); live.top = Math.max(0, f.top + dy); }
    else {
      const mw = MIN_W * ux, mh = MIN_H * uy;
      if (act.dir.includes('e')) live.width = Math.max(mw, Math.min(size.w - f.left, f.width + dx));
      if (act.dir.includes('s')) live.height = Math.max(mh, f.height + dy);
      if (act.dir.includes('w')) { const l = Math.max(0, Math.min(f.left + f.width - mw, f.left + dx)); live.width = f.width + f.left - l; live.left = l; }
      if (act.dir.includes('n')) { const t = Math.max(0, Math.min(f.top + f.height - mh, f.top + dy)); live.height = f.height + f.top - t; live.top = t; }
    }
    const x = Math.round(live.left / ux), y = Math.round(live.top / uy);
    const cell: Cell = { id: act.id, x, y, w: Math.round((live.left + live.width) / ux) - x, h: Math.round((live.top + live.height) / uy) - y };
    setView(act.dir === 'move' ? moveCell(act.base, { ...act.from, x, y }) : resizeCell(act.base, cell));
    setAct({ ...act, live });
  };
  const end = () => { if (!act) return; if (view) onChange(view); setAct(null); setView(null); };
  const cancel = () => { setAct(null); setView(null); };

  // teclado: setas mudam de sítio, Shift + setas mudam o tamanho
  const onKey = (c: Cell) => (e: KeyboardEvent) => {
    if (!editing || flow || e.target !== e.currentTarget) return;
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    onChange(e.shiftKey ? resizeCell(cells, { ...c, w: c.w + d[0], h: c.h + d[1] }) : moveCell(cells, { ...c, x: c.x + d[0], y: c.y + d[1] }));
  };

  const ghost = act ? shown.find((c) => c.id === act.id) : null;
  const rows = Math.max(SCREEN_ROWS, rowsOf(shown)) + (editing ? 10 : 0); // a editar há espaço livre por baixo
  const list = flow ? [...cells].sort((a, b) => a.y - b.y || a.x - b.x) : shown;
  return (
    <div ref={box} className={'pco-scroll' + (editing ? ' editing' : '')}>
      <div className={'pco-board' + (flow ? ' flow' : '')} style={flow ? undefined : { height: rows * uy }}>
        {ghost && <div className="pco-ghost" style={rect(ghost)} />}
        {size.w > 0 && list.map((c) => {
          const on = act?.id === c.id;
          return (
            <div key={c.id} className={'pco-slot' + (on ? ' active' : '')} style={flow ? undefined : on ? act.live : rect(c)} tabIndex={editing && !flow ? 0 : undefined}
              role={editing ? 'group' : undefined} aria-label={editing ? names(c.id) : undefined} onKeyDown={onKey(c)}
              onPointerDown={start(c.id, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}>
              <div className="pco-cell">{render(c.id)}</div>
              {editing && <>
                {!flow && DIRS.map((d) => <span key={d} className={'pco-rs ' + d} aria-hidden="true" onPointerDown={start(c.id, d)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} />)}
                {cells.length > 1 && <button type="button" className="pco-wdel" onClick={() => onRemove(c.id)} aria-label={L('Tirar widget')}>✕</button>}
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
