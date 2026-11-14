import { describe, it, expect } from 'vitest';
import { assertCents, formatMoney, parseMoneyToCents } from './money';

describe('assertCents', () => {
  it('accepts integers >= 0', () => {
    assertCents(0);
    assertCents(1250);
  });
  it('rejects non-integers and negatives', () => {
    expect(() => assertCents(12.5)).toThrow();
    expect(() => assertCents(-1)).toThrow();
    expect(() => assertCents(NaN)).toThrow();
  });
});

describe('parseMoneyToCents (no float)', () => {
  it('parses pt-PT style', () => {
    expect(parseMoneyToCents('12,50')).toBe(1250);
    expect(parseMoneyToCents('1.234,50')).toBe(123450);
    expect(parseMoneyToCents('5730,70')).toBe(573070);
  });
  it('parses en style', () => {
    expect(parseMoneyToCents('12.50')).toBe(1250);
    expect(parseMoneyToCents('1,234.56')).toBe(123456);
  });
  it('rejects more than 2 decimals and garbage', () => {
    expect(parseMoneyToCents('12.500')).toBe(null);
    expect(parseMoneyToCents('abc')).toBe(null);
    expect(parseMoneyToCents('')).toBe(null);
  });
});

describe('formatMoney', () => {
  it('formats cents with Intl in pt-PT and en', () => {
    // pt-PT uses a non-breaking space (U+00A0) before the currency sign.
    expect(formatMoney(1250, 'EUR', 'pt-PT')).toBe('12,50\u00a0€');
    expect(formatMoney(1250, 'EUR', 'en-US')).toBe('€12.50');
  });
  it('throws on non-integer cents', () => {
    expect(() => formatMoney(12.5, 'EUR', 'pt-PT')).toThrow();
  });
});
