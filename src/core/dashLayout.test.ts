import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYOUT, normalize, moveWidget, removeWidget, addWidget, nudgeWidget, pruneLayout } from './dashLayout';

describe('dashLayout', () => {
  // disposição de exemplo (independente da disposição de origem)
  const L = [['goals', 'budget', 'summary'], ['overview', 'categories', 'calendar'], ['recent']];
  it('normalize devolve o padrão com dados inválidos', () => {
    expect(normalize(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalize([[1], [], []])).toEqual(DEFAULT_LAYOUT);
    expect(normalize([['a'], ['a', 'b'], []])).toEqual([['a'], ['b'], []]);
  });
  it('moveWidget muda de coluna e posição sem duplicar', () => {
    const r = moveWidget(L, 'goals', 2, 'recent');
    expect(r[0]).toEqual(['budget', 'summary']);
    expect(r[2]).toEqual(['goals', 'recent']);
    expect(r.flat().filter((x) => x === 'goals')).toHaveLength(1);
    expect(moveWidget(L, 'goals', 2, null)[2]).toEqual(['recent', 'goals']);
  });
  it('removeWidget e addWidget', () => {
    const r = removeWidget(L, 'budget');
    expect(r.flat()).not.toContain('budget');
    expect(addWidget(r, 'x').flat()).toContain('x');
    expect(addWidget(L, 'goals')).toEqual(L);
    expect(addWidget(L, 'novo')[2]).toEqual(['recent', 'novo']);
  });
  it('nudgeWidget respeita os limites', () => {
    expect(nudgeWidget(L, 'goals', 'up')).toEqual(L);
    expect(nudgeWidget(L, 'goals', 'down')[0]).toEqual(['budget', 'goals', 'summary']);
    expect(nudgeWidget(L, 'goals', 'left')).toEqual(L);
    expect(nudgeWidget(L, 'goals', 'right')[1][0]).toBe('goals');
  });
  it('pruneLayout remove ids inexistentes', () => {
    expect(pruneLayout([['a', 'b'], [], []], (id) => id === 'a')[0]).toEqual(['a']);
  });
});

describe('disposição por modo', () => {
  it('Mês e Ano guardam-se em separado; a antiga serve de ponto de partida', async () => {
    const { loadLayout, saveLayout, DEFAULT_LAYOUT } = await import('./dashLayout');
    const mem = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), clear: () => mem.clear() };
    localStorage.clear();
    saveLayout([['recent'], ['overview'], []]); // disposição antiga (única)
    expect(loadLayout('month')).toEqual([['recent'], ['overview'], []]);
    saveLayout([['goals'], [], []], 'year');
    expect(loadLayout('year')).toEqual([['goals'], [], []]);
    expect(loadLayout('month')).toEqual([['recent'], ['overview'], []]);
    localStorage.clear();
    expect(loadLayout('year')).toEqual(DEFAULT_LAYOUT);
  });
});
