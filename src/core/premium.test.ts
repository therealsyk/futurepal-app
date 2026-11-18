import { describe, it, expect, beforeEach } from 'vitest';
import type { Category, Transaction } from '../db/database';
import { irsSummary, detectSubscriptions, monthForecast, evaluateChallenge, yearReview, warrantyEnd, businessQuarters, businessCsv } from './premium';
import { activePlan, hasFeature, startTrial, loadPlan, savePlan, withinFreeLimit } from './plan';

const cat = (id: string, nameKey: string) => ({ id, nameKey, name: nameKey, color: '#000', icon: '', order: 0, createdAt: '', updatedAt: '', deletedAt: null }) as Category;
let n = 0;
const tx = (date: string, amountCents: number, categoryId: string, description = '', type: 'expense' | 'income' = 'expense') =>
  ({ id: 't' + n++, date, amountCents, categoryId, description, type, currency: 'EUR', createdAt: '', updatedAt: '', deletedAt: null }) as Transaction;
const cats = [cat('h', 'catHealth'), cat('g', 'catGroceries'), cat('s', 'catShopping'), cat('c', 'catCoffee'), cat('o', 'catOther')];

describe('Modo IRS', () => {
  it('agrupa por dedução e respeita o limite', () => {
    const lines = irsSummary([tx('2026-02-01', 1_000_000, 'h'), tx('2026-03-01', 10_000, 'g'), tx('2025-03-01', 99_999, 'h')], cats, 2026);
    const health = lines.find((l) => l.group === 'health')!;
    expect(health.totalCents).toBe(1_000_000);
    expect(health.estimateCents).toBe(100_000); // 15% limitado a 1000 €
    expect(lines.find((l) => l.group === 'general')!.estimateCents).toBe(3_500);
  });
});

describe('subscrições', () => {
  it('deteta pagamento mensal e calcula o custo anual', () => {
    const subs = detectSubscriptions([tx('2026-08-05', 1099, 'o', 'Netflix 0815'), tx('2026-09-05', 1099, 'o', 'NETFLIX 0915'), tx('2026-10-05', 1099, 'o', 'netflix'), tx('2026-10-07', 500, 'o', 'Pingo Doce')], new Date(2026, 9, 20));
    expect(subs).toHaveLength(1);
    expect(subs[0].frequency).toBe('monthly');
    expect(subs[0].annualCents).toBe(13_188);
    expect(subs[0].nextDate).toBe('2026-11-05');
  });
  it('ignora valores muito diferentes', () => {
    expect(detectSubscriptions([tx('2026-08-05', 1000, 'o', 'Loja'), tx('2026-09-05', 5000, 'o', 'Loja')])).toHaveLength(0);
  });
});

describe('previsão do mês', () => {
  it('projeta ao ritmo atual e só no mês corrente', () => {
    const f = monthForecast(30_000, 150_000, 2026, 11, new Date(2026, 10, 10))!;
    expect(f.projectedSpendCents).toBe(90_000);
    expect(f.projectedBalanceCents).toBe(60_000);
    expect(monthForecast(1, 1, 2026, 10, new Date(2026, 10, 10))).toBeNull();
  });
});

describe('desafios e ano', () => {
  it('semana sem compras: perde com uma compra, ganha sem compras', () => {
    const ch = { id: 'x', type: 'noShopping' as const, startDate: '2026-11-01', weeksDone: [] };
    expect(evaluateChallenge(ch, [tx('2026-11-03', 2000, 's')], cats, new Date(2026, 10, 5)).status).toBe('lost');
    expect(evaluateChallenge(ch, [tx('2026-11-03', 2000, 'g')], cats, new Date(2026, 10, 10)).status).toBe('won');
  });
  it('52 semanas soma os valores das semanas feitas', () => {
    expect(evaluateChallenge({ id: 'y', type: 'week52', startDate: '2026-01-01', weeksDone: [1, 2, 10] }, [], cats).savedCents).toBe(1300);
  });
  it('ano em números', () => {
    const r = yearReview([tx('2026-01-02', 150, 'c'), tx('2026-03-02', 5000, 'g'), tx('2026-03-03', 1000, 'o', 'x', 'income')], cats, 2026, 100_000, new Date(2026, 11, 31));
    expect(r.spentCents).toBe(5150);
    expect(r.savedCents).toBe(101_000 - 5150);
    expect(r.coffeeCount).toBe(1);
    expect(r.priciestMonth?.month).toBe(3);
  });
  it('garantia e independentes', () => {
    expect(warrantyEnd('2026-01-31', 1)).toBe('2026-03-03');
    const a = tx('2026-05-10', 2000, 'o', 'Portátil'), b = tx('2026-05-11', 50_000, 'o', 'Fatura cliente', 'income');
    const q = businessQuarters([a, b, tx('2026-05-12', 1, 'o')], new Set([a.id, b.id]), 2026);
    expect(q[1]).toMatchObject({ incomeCents: 50_000, expenseCents: 2000, count: 2 });
    expect(businessCsv([a], new Set([a.id]), () => 'Outros', 2026)).toContain('2026-05-10;Despesa;"Outros";"Portátil";20,00');
  });
});

describe('planos', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear() };
  });
  it('grátis tem limites; o teste ativa o Plus uma só vez', () => {
    expect(activePlan()).toBe('free');
    expect(withinFreeLimit('accounts', 2)).toBe(false);
    startTrial(14);
    expect(activePlan()).toBe('plus');
    expect(hasFeature('irs')).toBe(true);
    expect(hasFeature('freelance')).toBe(false);
    savePlan({ ...loadPlan(), trialEndsAt: new Date(Date.now() - 1000).toISOString() });
    expect(activePlan()).toBe('free');
    expect(startTrial(14).trialEndsAt).not.toBeNull();
    expect(activePlan()).toBe('free'); // já usado
  });
});
