import { describe, it, expect } from 'vitest';
import type { Account, Transfer } from '../db/database';
import { accountBalanceCents } from './accounts';
import { afterPayments, beforePayments, debtStatus, goalValueCents, joinDesc, payoff, splitDesc } from './debtPlan';

const now = new Date(2026, 10, 22);
const acc = (description: string, initialBalanceCents = 6460000) => ({ id: 'd', type: 'debt', description, initialBalanceCents, deletedAt: null } as Account);
const tr = (date: string, amountCents: number, toAccountId = 'd') => ({ id: date, date, amountCents, toAccountId, fromAccountId: 'x', deletedAt: null } as Transfer);

describe('plano da conta', () => {
  it('guarda e lê o plano sem estragar a descrição (e lê o formato antigo)', () => {
    const p = { monthlyCents: 50000, startCents: 6460000, rate: 3.5, goalId: 'g1' };
    const d = joinDesc('Casa de Lisboa ', p);
    expect(splitDesc(d)).toEqual({ text: 'Casa de Lisboa', plan: p });
    expect(joinDesc(d, null)).toBe('Casa de Lisboa');
    expect(splitDesc('Casa⁣plan:50000:6460000')).toEqual({ text: 'Casa', plan: { monthlyCents: 50000, startCents: 6460000 } });
    expect(splitDesc('x⁣plan:lixo').plan).toBeNull();
    expect(splitDesc(undefined)).toEqual({ text: '', plan: null });
  });
  it('sem juros: quanto já foi abatido e quando acaba', () => {
    const s = debtStatus(acc(joinDesc('', { monthlyCents: 50000, startCents: 6460000 })), 6000000, [tr('2026-11-02', 30000), tr('2026-10-02', 99), tr('2026-11-03', 5, 'outra')], now);
    expect(s).toMatchObject({ paid: 460000, inThisMonth: 30000, months: 120, totalCents: 6000000 });
  });
  it('com juros: a prestação, a data e o total batem certo com a fórmula do crédito', () => {
    const r = payoff(10000000, 47742, 4)!; // 100 000 € a 4% em 30 anos: prestação 477,42 €
    expect(Math.abs(r.months - 360)).toBeLessThanOrEqual(1);
    expect(r.totalCents).toBeGreaterThan(17100000);
    expect(payoff(10000000, 33000, 4)).toBeNull(); // nem paga os juros
    expect(payoff(0, 1, 4)).toEqual({ months: 0, totalCents: 0 });
  });
  it('com juros, cada prestação só baixa a parte que não é juro, e a previsão encurta um mês de cada vez', () => {
    const plan = { monthlyCents: 47742, startCents: 10000000, rate: 4 };
    const a = acc(joinDesc('', plan), 10000000);
    const bal = accountBalanceCents(a, [], [a], 0, [tr('2026-11-02', 47742)]);
    expect(bal).toBe(10000000 + 33333 - 47742);
    expect(debtStatus(a, bal, [], now).months).toBe(payoff(10000000, 47742, 4)!.months - 1);
    for (const paid of [0, 20000, 47742, 500000]) expect(Math.abs(beforePayments(afterPayments(10000000, paid, plan), paid, plan) - 10000000)).toBeLessThanOrEqual(2);
  });
  it('sem juros o saldo é o de sempre; na meta conta o que já foi abatido', () => {
    const a = acc(joinDesc('', { monthlyCents: 100, startCents: 6460000 }));
    expect(accountBalanceCents(a, [], [a], 0, [tr('2026-11-02', 30000)])).toBe(6430000);
    expect(goalValueCents(a, 6430000)).toBe(30000);
    expect(goalValueCents({ ...a, type: 'savings' }, 500)).toBe(500);
  });
  it('sem valor mensal não prevê; paga, acabou; a dívida pode crescer', () => {
    expect(debtStatus(acc(''), 6460000, [], now)).toMatchObject({ monthly: 0, months: null, paid: 0 });
    expect(debtStatus(acc(''), 0, [], now)).toMatchObject({ months: 0, ratio: 1 });
    expect(debtStatus(acc(joinDesc('', { monthlyCents: 1, startCents: 100 })), 150, [], now)).toMatchObject({ start: 150, paid: 0, ratio: 0 });
  });
});
