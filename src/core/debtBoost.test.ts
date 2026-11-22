import { describe, expect, it } from 'vitest';
import type { Account, Transaction, Transfer } from '../db/database';
import { budget, options, simulate, usualPayment } from './debtBoost';

const now = new Date('2026-11-22T12:00:00');
const base = { createdAt: '', updatedAt: '', deletedAt: null };
const tx = (date: string, type: 'income' | 'expense', amountCents: number): Transaction => ({ ...base, id: date + type, date, type, categoryId: 'c', description: '', amountCents, currency: 'EUR' });
const acc = (id: string, type: Account['type']): Account => ({ ...base, id, name: id, description: '', type, currency: 'EUR', initialBalanceCents: 0, includeInNetWorth: true, isDefault: false, showOnHome: true, order: 0 });
const tr = (date: string, cents: number): Transfer => ({ ...base, id: date, fromAccountId: 'm', toAccountId: 'd', amountCents: cents, date, note: '', categoryId: null });
const months = ['05', '06', '07', '08', '09', '10'];
const txs = months.flatMap((m) => [tx(`2026-${m}-01`, 'income', 200000), tx(`2026-${m}-10`, 'expense', 120000)]);
const trs = months.map((m) => tr(`2026-${m}-05`, 30000));
const accs = [acc('m', 'spending'), acc('d', 'debt')];

describe('acabar a dívida mais depressa', () => {
  it('sugere só metade do que sobra e deixa o resto para poupar', () => {
    const b = budget(txs, trs, accs, 1000000, now);
    expect(b).toMatchObject({ months: 6, freeCents: 50000, extraCents: 25000, keepCents: 25000, debtCents: 30000 });
    expect(b.lumpCents).toBe(275000); // (10 000 − 3 meses de 1 500) ÷ 2
  });
  it('sem folga não sugere nada', () => {
    const tight = months.flatMap((m) => [tx(`2026-${m}-01`, 'income', 150000), tx(`2026-${m}-10`, 'expense', 130000)]);
    const b = budget(tight, trs, accs, 10000, now);
    expect(b.extraCents).toBe(0);
    expect(b.lumpCents).toBe(0);
    expect(options(1000000, 30000, 3, b)).toHaveLength(0);
    expect(budget([], [], accs, 0, now).extraCents).toBe(0);
  });
  it('pagar mais poupa meses e juros', () => {
    const e = simulate(1200000, 30000, 4, 200000, 30000)!;
    expect(e.saveMonths).toBeGreaterThan(5);
    expect(e.saveInterestCents).toBeGreaterThan(0);
    expect(simulate(1200000, 30000, 0, 0, 30000)).toEqual({ months: 40, saveMonths: 0, saveInterestCents: 0 });
    expect(simulate(1200000, 30000, 40, 0, 30000)).toBeNull();
  });
  it('as opções são crescentes e nunca passam do que é seguro', () => {
    const b = budget(txs, trs, accs, 1000000, now), o = options(1200000, 30000, 4, b);
    expect(o.map((x) => x.extra)).toEqual([8500, 16000, 25000]);
    expect(o[2].effect.months).toBeLessThan(o[0].effect.months);
  });
  it('sem valor combinado usa a média do que foi pago', () => {
    expect(usualPayment(0, 'd', trs, now)).toBe(30000);
    expect(usualPayment(45000, 'd', trs, now)).toBe(45000);
  });
});
