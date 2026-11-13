import { describe, it, expect } from 'vitest';
import { formatMoney, formatDate, getCountry, countryName } from './locale';

describe('formatMoney', () => {
  it('EUR in pt-PT (Node ICU may use narrow spaces as separators)', () => {
    const s = formatMoney(123456, 'EUR', 'pt-PT');
    // Keep only digits and the decimal comma, then re-group thousands.
    const digitsAndComma = s.replace(/[^\d,]/g, '');
    expect(digitsAndComma).toBe('1234,56');
  });

  it('USD in en-US', () => {
    expect(formatMoney(1050, 'USD', 'en-US')).toBe('$10.50');
  });

  it('BRL in pt-BR', () => {
    const s = formatMoney(999, 'BRL', 'pt-BR');
    expect(s).toContain('R$');
    expect(s).toContain('9,99');
  });

  it('JPY has no cents', () => {
    const s = formatMoney(12500, 'JPY', 'en-US');
    expect(s).toBe('¥125');
  });
});

describe('formatDate', () => {
  it('formats a YYYY-MM-DD string in pt-PT (numeric short format in Node)', () => {
    const s = formatDate('2026-03-05', 'pt-PT');
    expect(s).toMatch(/0?5\/0?3\/2026/);
  });

  it('formats a Date in en-US', () => {
    const s = formatDate(new Date(2026, 2, 5), 'en-US');
    expect(s).toBe('3/5/2026');
  });
});

describe('country helpers', () => {
  it('finds Portugal with EUR and Monday as first day', () => {
    const pt = getCountry('pt');
    expect(pt?.currency).toBe('EUR');
    expect(pt?.firstDayOfWeek).toBe(1);
  });

  it('returns translated country names', () => {
    expect(countryName('PT', 'en')).toBe('Portugal');
    expect(countryName('US', 'pt-PT')).toContain('Estados Unidos');
  });
});
