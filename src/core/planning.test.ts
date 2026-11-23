import { describe, expect, it } from 'vitest';
import type { Account, Goal, Recurring, Salary, Transaction, Transfer } from '../db/database';
import { DEFAULT_PLAN_OPTIONS, monthlyClose, moments, project, simulate, summarize, type PlanInput } from './planning';
import { joinDesc } from './debtPlan';

const S = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null };
const acc = (id: string, type: Account['type'], init: number, extra: Partial<Account> = {}): Account => ({ id, name: id, description: '', type, currency: 'EUR', initialBalanceCents: init, includeInNetWorth: true, isDefault: id === 'main', showOnHome: true, order: 0, ...S, ...extra });
const tx = (id: string, date: string, cents: number, extra: Partial<Transaction> = {}): Transaction => ({ id, date, type: cents < 0 ? 'expense' : 'income', categoryId: 'c', description: id, amountCents: Math.abs(cents), currency: 'EUR', accountId: 'main', ...S, ...extra });
const rec = (id: string, nextDate: string, cents: number, extra: Partial<Recurring> = {}): Recurring => ({ id, type: cents < 0 ? 'expense' : 'income', categoryId: 'r', description: id, amountCents: Math.abs(cents), currency: 'EUR', frequency: 'monthly', accountId: 'main', nextDate, ...S, ...extra });
const tr = (id: string, from: string, to: string, date: string, cents: number): Transfer => ({ id, fromAccountId: from, toAccountId: to, amountCents: cents, date, note: id, categoryId: null, transactionId: null, ...S });
const sal = (y: number, m: number, cents: number): Salary => ({ id: `s${y}${m}`, year: y, month: m, amountCents: cents, ...S });

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  today: '2026-11-10', currency: 'EUR', accounts: [acc('main', 'spending', 100000)], txs: [], transfers: [], salaries: [], recurrings: [], budgets: [], goals: [],
  options: { ...DEFAULT_PLAN_OPTIONS, estimate: 'off' }, groups: { oweCents: 0, owedToMeCents: 0 }, ...over,
});
const month = (inp: PlanInput) => project(inp, '2026-11-01', '2026-11-30');

describe('planeamento: reconciliação', () => {
  it('transação com data futura não entra no saldo de hoje e entra uma vez na previsão', () => {
    const p = month(base({ txs: [tx('past', '2026-11-05', -2000), tx('future', '2026-11-20', -5000)] }));
    expect(p.todayBalance).toBe(98000);
    const s = summarize(p);
    expect(s.oneoff).toBe(-5000);
    expect(s.endProjected).toBe(93000);
  });
  it('recorrência já registada não volta a contar (só a partir da próxima data)', () => {
    const inp = base({ txs: [tx('rent-1', '2026-11-01', -65000, { recurringId: 'rent' })], recurrings: [rec('rent', '2026-12-01', -65000)] });
    const p = project(inp, '2026-11-01', '2026-12-31');
    expect(p.events.filter((e) => e.sourceId === 'rent')).toHaveLength(1);
    expect(summarize(p).endProjected).toBe(100000 - 65000 - 65000);
  });
  it('recorrência vencida e ainda não registada conta amanhã, não no saldo de hoje', () => {
    const p = month(base({ recurrings: [rec('gym', '2026-11-08', -3000)] }));
    expect(p.events[0].date).toBe('2026-11-11');
    expect(p.events[0].overdue).toBe(true);
    expect(p.todayBalance).toBe(100000);
  });
  it('transferências entre contas incluídas não mudam o total; para uma dívida saem do conjunto', () => {
    const accounts = [acc('main', 'spending', 100000), acc('sav', 'savings', 0), acc('loan', 'debt', 500000)];
    const inp = base({ accounts, recurrings: [rec('save', '2026-11-15', 0, { amountCents: 10000, type: 'expense', toAccountId: 'sav' }), rec('pay', '2026-11-20', 0, { amountCents: 20000, type: 'expense', toAccountId: 'loan' })] });
    const p = month(inp);
    expect(p.events.map((e) => e.sourceId)).toEqual(['pay']); // a poupança fica dentro do conjunto
    const s = summarize(p);
    expect(s.instalments).toBe(-20000);
    expect(s.endProjected).toBe(80000);
    // só com a conta de gastos escolhida, a transferência para a poupança passa a sair do conjunto
    const only = summarize(month({ ...inp, options: { ...inp.options, accountIds: ['main'] } }));
    expect(only.transfers).toBe(-10000);
  });
  it('dívidas nunca entram como dinheiro próprio', () => {
    const p = month(base({ accounts: [acc('main', 'spending', 100000), acc('loan', 'debt', 500000)] }));
    expect(p.accounts.map((a) => a.id)).toEqual(['main']);
    // transferência futura já registada para a dívida: sai do conjunto uma vez
    const q = month(base({ accounts: [acc('main', 'spending', 100000), acc('loan', 'debt', 500000)], transfers: [tr('x', 'main', 'loan', '2026-11-28', 7000)] }));
    expect(summarize(q).instalments).toBe(-7000);
    expect(p.todayBalance).toBe(100000);
  });
});

describe('planeamento: rendimentos e projeção parcial', () => {
  it('salário registado para um mês futuro entra no dia 1; sem registo fica projeção parcial (não assume)', () => {
    const inp = base({ salaries: [sal(2026, 10, 150000), sal(2026, 11, 150000), sal(2026, 12, 150000)] });
    const p = project(inp, '2026-11-01', '2027-01-31');
    expect(p.events.find((e) => e.kind === 'salary')?.date).toBe('2026-12-01');
    expect(p.partial).toContainEqual({ kind: 'noIncome', month: '2027-01' });
  });
  it('rendimento extra isolado não se repete', () => {
    const p = project(base({ txs: [tx('bonus', '2026-10-15', 50000)] }), '2026-11-01', '2026-12-31');
    expect(p.events).toHaveLength(0);
  });
  it('défice antes do próximo rendimento é detetado mesmo com saldo final positivo', () => {
    const inp = base({ accounts: [acc('main', 'spending', 10000)], salaries: [sal(2026, 11, 100000), sal(2026, 12, 100000)], recurrings: [rec('rent', '2026-11-25', -60000, { frequency: 'yearly' })] });
    const s = summarize(project({ ...inp, salaries: inp.salaries.map((x) => (x.month === 11 ? { ...x, amountCents: 0 } : x)) }, '2026-11-01', '2026-12-31'));
    expect(s.firstNegative).toBe('2026-11-25');
    expect(s.shortfallBeforeIncome?.cents).toBe(-50000);
    expect(s.endProjected).toBe(50000);
    expect(s.margin).toBeLessThan(0);
  });
});

describe('planeamento: estimativas', () => {
  const hist = [
    tx('a', '2026-08-10', -31000), tx('b', '2026-09-10', -30000), tx('c', '2026-10-10', -31000),
    tx('rent8', '2026-08-01', -65000, { recurringId: 'rent' }), // gerada pela recorrência: não é variável
    tx('manualRent', '2026-09-01', -65000, { description: 'Renda' }), // igual a uma recorrência ativa: fica de fora
  ];
  const recs = [rec('rent', '2026-12-01', -65000, { description: 'Renda' })];
  it('usa os últimos meses completos, sem recorrências nem duplicados', () => {
    const p = month(base({ txs: hist, recurrings: recs, options: { ...DEFAULT_PLAN_OPTIONS, estimate: 'history' } }));
    expect(p.estimate.months).toBe(3);
    expect(p.estimate.excludedDup).toBe(1);
    expect(p.estimate.dailyCents).toBe(Math.round(92000 / 92));
    // só os 20 dias que faltam (11 a 30) são estimados
    expect(summarize(p).estimated).toBe(-20 * Math.round(92000 / 92));
  });
  it('histórico curto: não estima e diz porquê (não assume zero em silêncio)', () => {
    const p = month(base({ today: '2026-11-05', txs: [tx('x', '2026-11-02', -1000)], options: { ...DEFAULT_PLAN_OPTIONS, estimate: 'history' } }));
    expect(p.estimate.ok).toBe(false);
    expect(p.partial).toContainEqual({ kind: 'noHistory' });
  });
});

describe('planeamento: reservas, metas e grupos', () => {
  const goal: Goal = { id: 'g', name: 'Carro', targetCents: 500000, currentCents: 100000, startDate: '2026-01-01', notes: joinDesc('', { monthlyCents: 20000, startCents: 0 }), ...S };
  it('reserva e metas baixam a margem, não o saldo', () => {
    const p = month(base({ goals: [goal], options: { ...DEFAULT_PLAN_OPTIONS, estimate: 'off', reserveCents: 5000 } }));
    const s = summarize(p);
    expect(s.endProjected).toBe(100000);
    expect(s.margin).toBe(100000 - 5000 - 20000);
  });
  it('meta ligada a uma conta não é reservada (o dinheiro já vai por transferência)', () => {
    const p = month(base({ goals: [{ ...goal, accountIds: ['sav'] }] }));
    expect(p.reserves.goals).toBe(0);
  });
  it('o que falta pagar nos grupos baixa a margem; o que me devem não conta como garantido', () => {
    const s = summarize(month(base({ groups: { oweCents: 3000, owedToMeCents: 90000 } })));
    expect(s.margin).toBe(97000);
    expect(s.endProjected).toBe(100000);
  });
  it('sem ligação aos grupos: projeção parcial', () => {
    expect(month(base({ groups: null })).partial).toContainEqual({ kind: 'groupsUnknown' });
  });
});

describe('planeamento: coerência e simulações', () => {
  const inp = base({ salaries: [sal(2026, 12, 150000)], recurrings: [rec('rent', '2026-12-01', -65000), rec('ins', '2027-01-20', -18000, { frequency: 'yearly' })] });
  it('o fecho de dezembro é igual na vista mensal e na anual', () => {
    const m = summarize(project(inp, '2026-12-01', '2026-12-31')).endProjected;
    const y = monthlyClose(project(inp, '2026-01-01', '2026-12-31')).find((x) => x.month === '2026-12')!.close;
    expect(m).toBe(y);
  });
  it('a simulação não mexe nos dados reais', () => {
    const copy = JSON.stringify(inp);
    const sim = simulate(inp, { kind: 'oneoff', cents: 40000, date: '2026-11-20', income: false });
    expect(summarize(month(sim)).endProjected).toBe(60000);
    expect(JSON.stringify(inp)).toBe(copy);
    const drop = simulate(inp, { kind: 'dropRecurring', recurringId: 'rent' });
    expect(drop.recurrings).toHaveLength(1);
    expect(inp.recurrings).toHaveLength(2);
  });
  it('despesa anual aparece nos momentos com o equivalente mensal só como informação', () => {
    const p = month(inp);
    const m = moments(p, summarize(p), inp, () => 0).find((x) => x.kind === 'annual');
    expect(m?.extra).toBe(1500);
    expect(summarize(p).endProjected).toBe(100000); // não é somado como despesa extra
  });
});

describe('planeamento: média alarga para 6 meses com gastos fora do normal', () => {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const normal = months.flatMap((mk, i) => [1, 2, 3].map((k) => tx(`n${i}${k}`, `${mk}-0${k}`, -3000, { categoryId: 'food' })));
  const opts = { ...DEFAULT_PLAN_OPTIONS, estimate: 'history' as const };
  it('sem nada fora do normal usa 3 meses', () => {
    expect(project(base({ txs: normal, options: opts }), '2026-11-01', '2026-11-30').estimate.months).toBe(3);
  });
  it('com um gasto pontual grande (ex.: IMT) nos últimos 3 meses usa 6 e não conta o pontual', () => {
    const e = project(base({ txs: [...normal, tx('imt', '2026-10-09', -430000, { categoryId: 'food' })], options: opts }), '2026-11-01', '2026-11-30').estimate;
    expect(e.months).toBe(6);
    expect(e.widened).toBe(true);
    expect(e.oneOffs?.map((t) => t.id)).toEqual(['imt']);
  });
});
