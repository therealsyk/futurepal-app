import { describe, expect, it } from 'vitest';
import { balances, householdSpent, settleUp, splitCents, type HouseholdExpense } from './family';

const members = [{ userId: 'a', displayName: 'Ana' }, { userId: 'b', displayName: 'Bruno' }, { userId: 'c', displayName: 'Carla' }];
const ex = (id: string, paidBy: string, amountCents: number, splitAmong: string[], extra: Partial<HouseholdExpense> = {}): HouseholdExpense =>
  ({ id, paidBy, description: id, amountCents, date: '2026-11-10', splitAmong, isSettlement: false, deletedAt: null, ...extra });

describe('family', () => {
  it('splits cents without losing any', () => {
    expect(splitCents(1000, 3)).toEqual([334, 333, 333]);
    expect(splitCents(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('computes balances that sum to zero', () => {
    const b = balances(members, [ex('luz', 'a', 9000, ['a', 'b', 'c']), ex('super', 'b', 3000, ['a', 'b', 'c'])]);
    expect(b).toEqual({ a: 5000, b: -1000, c: -4000 });
    expect(Object.values(b).reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('settles with the fewest payments', () => {
    const debts = settleUp({ a: 6000, b: -2000, c: -4000 });
    expect(debts).toEqual([{ from: 'c', to: 'a', amountCents: 4000 }, { from: 'b', to: 'a', amountCents: 2000 }]);
  });

  it('a settlement payment clears the debt and deleted rows are ignored', () => {
    const list = [
      ex('luz', 'a', 6000, ['a', 'b']),
      ex('acerto', 'b', 3000, ['a'], { isSettlement: true }),
      ex('apagada', 'a', 99999, ['b'], { deletedAt: '2026-11-11' }),
    ];
    expect(settleUp(balances(members, list))).toEqual([]);
    expect(householdSpent(list)).toBe(6000);
    expect(householdSpent(list, '2026-10')).toBe(0);
  });
});
