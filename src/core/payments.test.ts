import { describe, expect, it } from 'vitest';
import type { Recurring, Transaction } from '../db/database';
import { allPayments, detectPayments, inPeriod, nextFrom, payKey, serviceOf } from './payments';

const today = new Date('2026-11-22T12:00:00');
const tx = (date: string, cents: number, description: string, extra: Partial<Transaction> = {}): Transaction => ({ id: date + description, date, type: 'expense', categoryId: 'c', description, amountCents: cents, currency: 'EUR', createdAt: date, updatedAt: date, deletedAt: null, ...extra });
const rec = (p: Partial<Recurring>): Recurring => ({ id: 'r1', type: 'expense', categoryId: 'c', description: 'Netflix', amountCents: 1299, currency: 'EUR', frequency: 'monthly', nextDate: '2026-12-05', createdAt: '', updatedAt: '', deletedAt: null, ...p });
const netflix = [tx('2026-09-05', 1299, 'NETFLIX.COM 123'), tx('2026-10-05', 1299, 'Netflix com'), tx('2026-11-05', 1399, 'netflix.com 77')];

describe('pagamentos recorrentes', () => {
  it('junta nomes parecidos e reconhece o serviço', () => {
    expect(payKey('NETFLIX.COM 123')).toBe(payKey('Netflix com'));
    expect(serviceOf('NETFLIX.COM 0815')?.kind).toBe('stream');
    expect(serviceOf('Padaria da Vila')).toBeNull();
  });
  it('deteta um pagamento mensal, com a certeza só ao 3.º', () => {
    const [p] = detectPayments(netflix, today);
    expect(p).toMatchObject({ frequency: 'monthly', cents: 1399, nextDate: '2026-12-05', daysUntil: 13, sure: true });
    expect(detectPayments(netflix.slice(1), today)[0].sure).toBe(false);
  });
  it('ignora compras irregulares, valores muito diferentes e o que já parou', () => {
    expect(detectPayments([tx('2026-10-01', 1000, 'Loja'), tx('2026-11-01', 5000, 'Loja')], today)).toHaveLength(0);
    expect(detectPayments([tx('2026-10-01', 1000, 'Loja'), tx('2026-10-12', 1000, 'Loja'), tx('2026-11-19', 1000, 'Loja')], today)).toHaveLength(0);
    expect(detectPayments([tx('2026-05-05', 999, 'Gym'), tx('2026-06-05', 999, 'Gym'), tx('2026-07-05', 999, 'Gym')], today)).toHaveLength(0);
  });
  it('encontra padrões em extratos reais: compras soltas, um mês falhado e nomes que mudam', () => {
    const loose = [tx('2026-09-10', 4210, 'COMPRA NETFLIX 991'), ...netflix]; // uma compra solta no mesmo sítio
    expect(detectPayments(loose, today)).toHaveLength(1);
    const gap = ['2026-05-05', '2026-06-05', '2026-08-06', '2026-09-05', '2026-10-05', '2026-11-05'].map((d) => tx(d, 999, 'Spotify AB'));
    expect(detectPayments(gap, today)[0]).toMatchObject({ frequency: 'monthly', sure: true });
    const rent = ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].map((d, i) => tx(d, 65000, 'TRF 00' + i + ' xkq' + 'abcd'[i]));
    expect(detectPayments(rent, today)[0]).toMatchObject({ cents: 65000, frequency: 'monthly' });
    // extrato importado só até meados de outubro: continua ativo
    expect(detectPayments(['2026-08-05', '2026-09-05', '2026-10-05'].map((d) => tx(d, 1299, 'HBO Max')), today)).toHaveLength(1);
    // compras do dia a dia não são recorrentes
    expect(detectPayments(Array.from({ length: 20 }, (_, i) => tx(`2026-11-${String(i + 1).padStart(2, '0')}`, 120 + (i % 3) * 10, 'Café Central')), today)).toHaveLength(0);
  });
  it('a conta da luz varia e continua a ser detetada', () => {
    expect(detectPayments([tx('2026-09-10', 4000, 'EDP'), tx('2026-10-10', 5200, 'EDP'), tx('2026-11-10', 4600, 'EDP')], today)).toHaveLength(1);
  });
  it('não sugere o que já foi adicionado nem o que foi recusado', () => {
    expect(allPayments(netflix, [], [], today).found).toHaveLength(1);
    expect(allPayments(netflix, [rec({ description: 'Netflix.com' })], [], today).found).toHaveLength(0);
    expect(allPayments(netflix, [], [payKey('Netflix com')], today).found).toHaveLength(0);
    expect(allPayments([], [rec({ toAccountId: 'x' })], [], today).added).toHaveLength(0);
    expect(allPayments([], [rec({ endDate: '2026-10-01' })], [], today).added).toHaveLength(0);
  });
  it('quanto saiu e quanto falta sair no período', () => {
    const p = allPayments(netflix, [rec({ description: 'Netflix.com' })], [], today).added[0];
    expect(inPeriod(p, '2026-11-01', '2026-11-30', today)).toEqual({ paid: 1399, due: 0 });
    expect(inPeriod(p, '2026-01-01', '2026-12-31', today)).toEqual({ paid: 3997, due: 1299 });
  });
  it('a próxima data nunca fica no passado', () => {
    const [p] = detectPayments([tx('2026-08-20', 500, 'A'), tx('2026-09-20', 500, 'A'), tx('2026-10-20', 500, 'A')], today);
    expect(nextFrom(p, today)).toBe('2026-12-20');
  });
});

describe('deteção de recorrentes: casos que não fazem sentido', () => {
  const S = { createdAt: '', updatedAt: '', deletedAt: null };
  const t = (id: string, date: string, cents: number, description: string, categoryId: string) => ({ id, date, type: 'expense' as const, categoryId, description, amountCents: cents, currency: 'EUR', accountId: 'main', ...S });
  it('10 € de gasolina duas vezes com 6 meses de intervalo não é recorrente', () => {
    const txs = [t('a', '2026-04-10', 1000, 'Galp', 'cat-catGas'), t('b', '2026-10-10', 1000, 'Galp', 'cat-catGas'), t('c', '2026-06-02', 4500, 'Galp', 'cat-catGas'), t('d', '2026-08-20', 3800, 'Galp', 'cat-catGas')];
    expect(detectPayments(txs, new Date('2026-11-01T12:00:00'))).toHaveLength(0);
  });
  it('Netflix todos os meses continua a ser detetado', () => {
    const txs = ['2026-07-14', '2026-08-14', '2026-09-14', '2026-10-14'].map((d, i) => t('n' + i, d, 1299, 'NETFLIX.COM', 'cat-catSubscriptions'));
    expect(detectPayments(txs, new Date('2026-11-01T12:00:00')).map((p) => p.frequency)).toEqual(['monthly']);
  });
});
