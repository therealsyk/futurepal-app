import { describe, expect, it } from 'vitest';
import { dayTransactions, matchCategory, normalizeIntent, normalizeReceipt, quickIntent, spendSummary } from './assistant';
import type { Transaction } from '../db/database';

const today = '2026-11-18';
const tx = (id: string, date: string, amountCents: number, categoryId = 'food', type: 'expense' | 'income' = 'expense'): Transaction =>
  ({ id, date, amountCents, categoryId, type, description: id, currency: 'EUR', createdAt: '', updatedAt: '', deletedAt: null });

describe('assistant', () => {
  it('understands simple questions without AI', () => {
    expect(quickIntent('Tive despesas no dia 12/11?', today)).toEqual({ type: 'day', from: '2026-11-12', to: '2026-11-12', category: null });
    expect(quickIntent('o que gastei ontem', today)?.from).toBe('2026-11-17');
    expect(quickIntent('Quanto poupei este ano?', today)).toEqual({ type: 'savings', from: '2026-01-01', to: today, category: null });
    expect(quickIntent('Quanto gastei no mês passado?', today)).toEqual({ type: 'spending', from: '2026-10-01', to: '2026-10-31', category: null });
    expect(quickIntent('How much did I spend this month', today)?.from).toBe('2026-11-01');
    expect(quickIntent('quanto gastei em restaurantes desde março?', today)).toBeNull(); // vai para a IA
    expect(quickIntent('31/02', today)).toBeNull();
  });

  it('normalizes what the AI returns', () => {
    expect(normalizeIntent({ type: 'weird' }, today)).toEqual({ type: 'unknown', from: '2026-11-01', to: today, category: null });
    expect(normalizeIntent({ type: 'category', from: '2026-11-10', to: '2026-03-01', category: '' }, today)).toEqual({ type: 'spending', from: '2026-03-01', to: '2026-11-10', category: null });
    expect(normalizeIntent({ type: 'day', from: '2026-11-05', to: '2026-11-09' }, today).to).toBe('2026-11-05');
  });

  it('summarizes spending and days', () => {
    const txs = [tx('a', '2026-11-01', 1000), tx('b', '2026-11-02', 500, 'home'), tx('c', '2026-11-02', 3000, 'food', 'income'), tx('d', '2026-10-30', 999)];
    const s = spendSummary(txs, '2026-11-01', '2026-11-02');
    expect(s).toMatchObject({ totalCents: 1500, count: 2, days: 2, avgPerDayCents: 750 });
    expect(s.byCategory[0]).toEqual({ categoryId: 'food', cents: 1000 });
    expect(spendSummary(txs, '2026-11-01', '2026-11-30', 'home').totalCents).toBe(500);
    expect(dayTransactions(txs, '2026-11-02').map((t) => t.id)).toEqual(['c', 'b']);
  });

  it('matches categories loosely', () => {
    const cats = [{ id: '1', label: 'Restaurantes' }, { id: '2', label: 'Saúde' }];
    expect(matchCategory('saude', cats)?.id).toBe('2');
    expect(matchCategory('restaurante', cats)?.id).toBe('1');
    expect(matchCategory('carro', cats)).toBeNull();
  });

  it('validates receipts', () => {
    expect(normalizeReceipt({ ok: true, totalCents: 2345, date: '2026-11-15', merchant: 'Continente', category: 'Supermercado' }, today))
      .toEqual({ date: '2026-11-15', amountCents: 2345, description: 'Continente', category: 'Supermercado', currency: null });
    expect(normalizeReceipt({ ok: true, totalCents: 500, date: '2030-01-01' }, today)?.date).toBe(today);
    expect(normalizeReceipt({ ok: false, totalCents: 500 }, today)).toBeNull();
    expect(normalizeReceipt({ totalCents: 'abc' }, today)).toBeNull();
  });
});
