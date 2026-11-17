import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYOUT, normalize, moveWidget, removeWidget, addWidget, nudgeWidget, pruneLayout } from './dashLayout';

describe('dashLayout', () => {
  it('normalize devolve o padrão com dados inválidos', () => {
    expect(normalize(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalize([[1], [], []])).toEqual(DEFAULT_LAYOUT);
    expect(normalize([['a'], ['a', 'b'], []])).toEqual([['a'], ['b'], []]);
  });
  it('moveWidget muda de coluna e posição sem duplicar', () => {
    const r = moveWidget(DEFAULT_LAYOUT, 'goals', 2, 'recent');
    expect(r[0]).toEqual(['budget', 'summary']);
    expect(r[2]).toEqual(['goals', 'recent']);
    expect(r.flat().filter((x) => x === 'goals')).toHaveLength(1);
    expect(moveWidget(DEFAULT_LAYOUT, 'goals', 2, null)[2]).toEqual(['recent', 'goals']);
  });
  it('removeWidget e addWidget', () => {
    const r = removeWidget(DEFAULT_LAYOUT, 'budget');
    expect(r.flat()).not.toContain('budget');
    expect(addWidget(r, 'x').flat()).toContain('x');
    expect(addWidget(DEFAULT_LAYOUT, 'goals')).toEqual(DEFAULT_LAYOUT);
    expect(addWidget(DEFAULT_LAYOUT, 'novo')[2]).toEqual(['recent', 'novo']);
  });
  it('nudgeWidget respeita os limites', () => {
    expect(nudgeWidget(DEFAULT_LAYOUT, 'goals', 'up')).toEqual(DEFAULT_LAYOUT);
    expect(nudgeWidget(DEFAULT_LAYOUT, 'goals', 'down')[0]).toEqual(['budget', 'goals', 'summary']);
    expect(nudgeWidget(DEFAULT_LAYOUT, 'goals', 'left')).toEqual(DEFAULT_LAYOUT);
    expect(nudgeWidget(DEFAULT_LAYOUT, 'goals', 'right')[1][0]).toBe('goals');
  });
  it('pruneLayout remove ids inexistentes', () => {
    expect(pruneLayout([['a', 'b'], [], []], (id) => id === 'a')[0]).toEqual(['a']);
  });
});
