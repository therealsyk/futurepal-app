import { describe, it, expect } from 'vitest';
import { addCell, fromOrder, hit, moveCell, resizeCell, rowsOf, validLayout, COLS, MIN_W, type Cell } from './widgetGrid';

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const base = fromOrder(ids);
const clean = (cells: Cell[]) => cells.every((x, i) => cells.every((y, j) => i === j || !hit(x, y)) && x.x >= 0 && x.x + x.w <= COLS);
const get = (cells: Cell[], id: string) => cells.find((c) => c.id === id)!;

describe('grelha de widgets', () => {
  it('converte a ordem antiga sem sobrepor nada', () => {
    for (let n = 1; n <= 6; n++) { const l = fromOrder(ids.slice(0, n)); expect(clean(l)).toBe(true); expect(rowsOf(l)).toBe(24); }
  });
  it('um widget pode ser puxado para baixo, para um espaço vazio, e lá fica', () => {
    const l = moveCell(base, { ...get(base, 'f'), y: 24 });
    expect(get(l, 'f').y).toBe(24);
    expect(l.filter((c) => c.id !== 'f')).toEqual(base.filter((c) => c.id !== 'f'));
  });
  it('largado em cima de outro, trocam de lugar', () => {
    const l = moveCell(base, { ...get(base, 'f'), x: get(base, 'c').x, y: get(base, 'c').y });
    expect([get(l, 'f').x, get(l, 'c').x]).toEqual([get(base, 'c').x, get(base, 'f').x]);
    expect(clean(l)).toBe(true);
  });
  it('ao aumentar, o vizinho encolhe; quando já não pode, desce', () => {
    const l = resizeCell(base, { ...get(base, 'a'), w: 18 });
    expect(get(l, 'b')).toMatchObject({ x: 18, w: 6, y: 0 });
    const all = resizeCell(base, { ...get(base, 'a'), w: COLS });
    expect(get(all, 'b').y).toBe(12);
    expect(clean(l) && clean(all)).toBe(true);
  });
  it('nunca fica mais pequeno do que o mínimo, nem sobreposto, com movimentos ao acaso', () => {
    let l = base, r = 7;
    const rnd = (n: number) => { r = (r * 1103515245 + 12345) % 2147483648; return r % n; };
    for (let i = 0; i < 400; i++) {
      const c = l[rnd(l.length)];
      l = i % 2 ? moveCell(l, { ...c, x: rnd(30) - 3, y: rnd(40) - 3 }) : resizeCell(l, { ...c, w: rnd(30), h: rnd(30) });
      expect(clean(l)).toBe(true);
      expect(l.every((x) => x.w >= MIN_W)).toBe(true);
    }
  });
  it('junta um widget novo num espaço livre ou por baixo', () => {
    expect(get(addCell(base, 'g'), 'g').y).toBe(24);
    expect(get(addCell(base.filter((c) => c.id !== 'b'), 'g'), 'g')).toMatchObject({ x: 16, y: 0 });
  });
  it('recusa disposições guardadas estragadas', () => {
    expect(validLayout(base, ids)).toEqual(base);
    expect(validLayout([{ ...base[0] }, { ...base[0], id: 'b' }], ids)).toBeNull();
    expect(validLayout([{ ...base[0], id: 'x' }], ids)).toBeNull();
    expect(validLayout('lixo', ids)).toBeNull();
  });
});
