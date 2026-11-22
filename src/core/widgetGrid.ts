// Grelha livre do Resumo: cada widget ocupa um retângulo (24 colunas × linhas). Sem buracos obrigatórios: pode ficar onde a pessoa o puser.
export interface Cell { id: string; x: number; y: number; w: number; h: number }
export const COLS = 24, SCREEN_ROWS = 24, MIN_W = 4, MIN_H = 4, MAX_H = 48, MAX_Y = 120;

export const hit = (a: Cell, b: Cell) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const area = (a: Cell, b: Cell) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const between = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function clampCell(c: Cell): Cell {
  const w = between(Math.round(c.w), MIN_W, COLS), h = between(Math.round(c.h), MIN_H, MAX_H);
  return { id: c.id, w, h, x: between(Math.round(c.x), 0, COLS - w), y: between(Math.round(c.y), 0, MAX_Y) };
}

/** Mantém `fixed` onde está e empurra para baixo só o que ficar por cima dele (ou uns dos outros). */
function push(cells: Cell[], fixed: Cell): Cell[] {
  const done = [fixed];
  for (const c of cells.filter((x) => x.id !== fixed.id).sort((a, b) => a.y - b.y || a.x - b.x)) {
    let n = c, o: Cell | undefined;
    while ((o = done.find((d) => hit(d, n)))) n = { ...n, y: o.y + o.h };
    done.push(n);
  }
  return cells.map((c) => done.find((d) => d.id === c.id)!);
}

/** Mudar de sítio. Largado em cima de outro widget, trocam de lugar; senão fica onde foi posto. */
export function moveCell(base: Cell[], moved: Cell): Cell[] {
  const me = clampCell(moved), old = base.find((c) => c.id === me.id);
  if (!old) return base;
  const over = base.filter((c) => c.id !== me.id).map((c) => ({ c, a: area(me, c) / Math.min(me.w * me.h, c.w * c.h) })).sort((a, b) => b.a - a.a)[0];
  if (over && over.a >= 0.5) {
    return base.map((c) => (c.id === me.id ? { ...over.c, id: me.id } : c.id === over.c.id ? { ...old, id: c.id } : c));
  }
  return push(base.map((c) => (c.id === me.id ? me : c)), me);
}

/** Mudar o tamanho. Os vizinhos encolhem para dar espaço; se já não puderem encolher, descem. */
export function resizeCell(base: Cell[], sized: Cell): Cell[] {
  const me = clampCell(sized), old = base.find((c) => c.id === me.id);
  if (!old) return base;
  const trimmed = base.map((c) => {
    if (c.id === me.id) return me;
    if (!hit(me, c)) return c;
    const r = me.x + me.w, b = me.y + me.h, cr = c.x + c.w, cb = c.y + c.h;
    if (c.x >= old.x + old.w && cr - r >= MIN_W) return { ...c, x: r, w: cr - r };
    if (cr <= old.x && me.x - c.x >= MIN_W) return { ...c, w: me.x - c.x };
    if (c.y >= old.y + old.h && cb - b >= MIN_H) return { ...c, y: b, h: cb - b };
    if (cb <= old.y && me.y - c.y >= MIN_H) return { ...c, h: me.y - c.y };
    return c;
  });
  return push(trimmed, me);
}

/** Primeiro espaço livre para um widget novo (ou por baixo de tudo). */
export function addCell(cells: Cell[], id: string, w = 8, h = 12): Cell[] {
  const bottom = rowsOf(cells);
  for (let y = 0; y < bottom; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      const c = { id, x, y, w, h };
      if (y + h <= Math.max(bottom, SCREEN_ROWS) && !cells.some((o) => hit(o, c))) return [...cells, c];
    }
  }
  return [...cells, { id, x: 0, y: bottom, w, h }];
}

export const rowsOf = (cells: Cell[]) => cells.reduce((m, c) => Math.max(m, c.y + c.h), 0);

/** A disposição antiga (só por ordem: dois em cima, os outros em baixo) passa para a grelha. */
export function fromOrder(order: string[]): Cell[] {
  if (order.length === 1) return [{ id: order[0], x: 0, y: 0, w: COLS, h: SCREEN_ROWS }];
  const n = order.length - 2, top = n ? 12 : SCREEN_ROWS;
  return order.map((id, i) => {
    if (i < 2) return { id, x: i ? 16 : 0, y: 0, w: i ? 8 : 16, h: top };
    const w = Math.floor(COLS / n), k = i - 2;
    return { id, x: k * w, y: top, w: k === n - 1 ? COLS - k * w : w, h: SCREEN_ROWS - top };
  });
}

/** Disposição guardada: só vale se for toda válida e sem sobreposições. */
export function validLayout(v: unknown, ids: readonly string[]): Cell[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out: Cell[] = [];
  for (const c of v as Cell[]) {
    if (!c || !ids.includes(c.id) || out.some((o) => o.id === c.id) || ![c.x, c.y, c.w, c.h].every(Number.isInteger)) return null;
    const k = clampCell(c);
    if (out.some((o) => hit(o, k))) return null;
    out.push(k);
  }
  return out;
}
