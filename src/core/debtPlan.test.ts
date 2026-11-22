import { describe, it, expect } from 'vitest';
import type { Account, Transfer } from '../db/database';
import { debtStatus, joinDesc, splitDesc } from './debtPlan';

const now = new Date(2026, 10, 22);
const acc = (description: string, initialBalanceCents = 6460000) => ({ id: 'd', type: 'debt', description, initialBalanceCents } as Account);
const tr = (date: string, amountCents: number, toAccountId = 'd') => ({ id: date, date, amountCents, toAccountId, fromAccountId: 'x', deletedAt: null } as Transfer);

describe('plano da dívida', () => {
  it('guarda e lê o plano sem estragar a descrição', () => {
    const d = joinDesc('Casa de Lisboa ', { monthlyCents: 50000, startCents: 6460000 });
    expect(splitDesc(d)).toEqual({ text: 'Casa de Lisboa', plan: { monthlyCents: 50000, startCents: 6460000 } });
    expect(joinDesc(d, null)).toBe('Casa de Lisboa');
    expect(splitDesc(joinDesc(d, { monthlyCents: 1, startCents: 2 }))).toEqual({ text: 'Casa de Lisboa', plan: { monthlyCents: 1, startCents: 2 } });
    expect(splitDesc(undefined)).toEqual({ text: '', plan: null });
  });
  it('diz quanto já foi abatido e quando acaba', () => {
    const s = debtStatus(acc(joinDesc('', { monthlyCents: 50000, startCents: 6460000 })), 6000000, [tr('2026-11-02', 30000), tr('2026-10-02', 99), tr('2026-11-03', 5, 'outra')], now);
    expect(s).toMatchObject({ paid: 460000, paidThisMonth: 30000, months: 120 });
    expect([s.end!.getFullYear(), s.end!.getMonth()]).toEqual([2036, 10]);
  });
  it('sem plano não prevê; paga, acabou; a dívida pode crescer', () => {
    expect(debtStatus(acc(''), 6460000, [], now)).toMatchObject({ monthly: 0, months: null, end: null, paid: 0 });
    expect(debtStatus(acc(''), 0, [], now)).toMatchObject({ months: 0, ratio: 1 });
    expect(debtStatus(acc(joinDesc('', { monthlyCents: 1, startCents: 100 })), 150, [], now)).toMatchObject({ start: 150, paid: 0, ratio: 0 });
  });
});
