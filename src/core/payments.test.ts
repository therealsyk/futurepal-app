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
