import { describe, it, expect } from 'vitest';
import { advanceDate, monthlyEquivalentCents } from './finance';

describe('recorrentes', () => {
  it('avança diário, quinzenal e semanal', () => {
    expect(advanceDate('2026-01-31', 'daily')).toBe('2026-02-01');
    expect(advanceDate('2026-01-01', 'biweekly')).toBe('2026-01-15');
    expect(advanceDate('2026-12-28', 'weekly')).toBe('2027-01-04');
  });
  it('avança meses mantendo o dia original', () => {
    expect(advanceDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(advanceDate('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(advanceDate('2026-01-15', 'quarterly', 15)).toBe('2026-04-15');
    expect(advanceDate('2026-01-15', 'bimonthly', 15)).toBe('2026-03-15');
    expect(advanceDate('2026-08-31', 'semiannual', 31)).toBe('2027-02-28');
    expect(advanceDate('2024-02-29', 'yearly')).toBe('2025-02-28');
  });
  it('equivalente mensal', () => {
    expect(monthlyEquivalentCents(1200, 'monthly')).toBe(1200);
    expect(monthlyEquivalentCents(3000, 'quarterly')).toBe(1000);
    expect(monthlyEquivalentCents(12000, 'yearly')).toBe(1000);
  });
});
