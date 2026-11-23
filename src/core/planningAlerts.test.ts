import { describe, expect, it } from 'vitest';
import type { Account, Budget, Recurring, Transaction } from '../db/database';
import { DEFAULT_PLAN_OPTIONS, type PlanInput } from './planning';
import { buildAlerts, DEFAULT_ALERT_PREFS, visibleNote } from './planningAlerts';

const S = { createdAt: '', updatedAt: '', deletedAt: null };
const main: Account = { id: 'main', name: 'main', description: '', type: 'spending', currency: 'EUR', initialBalanceCents: 20000, includeInNetWorth: true, isDefault: true, showOnHome: true, order: 0, ...S };
const rec = (id: string, nextDate: string, cents: number, frequency: Recurring['frequency'] = 'monthly'): Recurring => ({ id, type: 'expense', categoryId: 'c', description: id, amountCents: cents, currency: 'EUR', frequency, accountId: 'main', nextDate, ...S });
const inp = (over: Partial<PlanInput> = {}): PlanInput => ({ today: '2026-11-10', currency: 'EUR', accounts: [main], txs: [], transfers: [], salaries: [], recurrings: [], budgets: [], goals: [], options: { ...DEFAULT_PLAN_OPTIONS, estimate: 'off' }, groups: { oweCents: 0, owedToMeCents: 0 }, ...over });

describe('alertas do planeamento', () => {
  it('ids estáveis: recalcular não cria avisos novos', () => {
    const a = buildAlerts(inp({ recurrings: [rec('net', '2026-11-12', 1299)] }), DEFAULT_ALERT_PREFS).map((x) => x.id);
    const b = buildAlerts(inp({ recurrings: [rec('net', '2026-11-12', 1299)] }), DEFAULT_ALERT_PREFS).map((x) => x.id);
    expect(a).toEqual(b);
    expect(a).toContain('pay:rec:net:2026-11-12');
  });
  it('pagamento resolvido (já registado, a recorrência avançou) deixa de avisar', () => {
    const ids = buildAlerts(inp({ recurrings: [rec('net', '2026-12-12', 1299)] }), DEFAULT_ALERT_PREFS).map((x) => x.id);
    expect(ids.some((x) => x.startsWith('pay:'))).toBe(false);
  });
  it('saldo negativo previsto avisa uma vez por mês, e não com dados incompletos', () => {
    const r = [rec('rent', '2026-11-20', 65000, 'yearly')];
    expect(buildAlerts(inp({ recurrings: r }), DEFAULT_ALERT_PREFS).filter((x) => x.kind === 'lowBalance').map((x) => x.id)).toEqual(['low:2026-11']);
    const incomplete = inp({ recurrings: r, options: { ...DEFAULT_PLAN_OPTIONS, estimate: 'history' } }); // sem histórico → parcial
    expect(buildAlerts(incomplete, DEFAULT_ALERT_PREFS).some((x) => x.kind === 'lowBalance')).toBe(false);
  });
  it('despesa anual: só o patamar atual (90/60/30)', () => {
    const ids = buildAlerts(inp({ recurrings: [rec('ins', '2026-12-25', 18000, 'yearly')] }), DEFAULT_ALERT_PREFS).filter((x) => x.kind === 'annual').map((x) => x.id);
    expect(ids).toEqual(['annual:ins:2026-12-25:60']);
  });
  it('limites: patamar atingido vs previsto são avisos diferentes', () => {
    const b: Budget = { id: 'b', categoryId: 'food', limitCents: 10000, period: 'month', year: 2026, month: 11, ...S };
    const tx = (id: string, date: string, cents: number): Transaction => ({ id, date, type: 'expense', categoryId: 'food', description: id, amountCents: cents, currency: 'EUR', accountId: 'main', ...S });
    const hit = buildAlerts(inp({ budgets: [b], txs: [tx('a', '2026-11-05', 8500)] }), DEFAULT_ALERT_PREFS).filter((x) => x.kind === 'budget');
    expect(hit.map((x) => x.id)).toEqual(['budget:food:2026-11:80']);
    const fc = buildAlerts(inp({ budgets: [b], txs: [tx('a', '2026-11-05', 4000)] }), DEFAULT_ALERT_PREFS).filter((x) => x.kind === 'budget');
    expect(fc.map((x) => x.id)).toEqual(['budgetFc:food:2026-11']);
  });
  it('preferências desligam um tipo', () => {
    const off = { ...DEFAULT_ALERT_PREFS, on: { ...DEFAULT_ALERT_PREFS.on, payment: false } };
    expect(buildAlerts(inp({ recurrings: [rec('net', '2026-11-12', 1299)] }), off).some((x) => x.kind === 'payment')).toBe(false);
  });
  it('lido ≠ dispensado; adiado volta no dia indicado', () => {
    const st = { read: { a: 'x' }, dismissed: { b: 'x' }, snoozed: { c: '2026-11-11' } };
    expect(visibleNote('a', st, '2026-11-10')).toBe(true);
    expect(visibleNote('b', st, '2026-11-10')).toBe(false);
    expect(visibleNote('c', st, '2026-11-10')).toBe(false);
    expect(visibleNote('c', st, '2026-11-11')).toBe(true);
  });
});
