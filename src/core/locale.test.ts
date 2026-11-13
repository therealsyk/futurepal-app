import { describe, it, expect } from 'vitest';
import { formatMoney, formatDate, getCountry, countryName, COUNTRIES, startOfWeek, formatDateByConvention } from './locale';

const SUPPORTED_LANGUAGES = ['pt-PT', 'pt-BR', 'en', 'es', 'fr'];

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

  it('every country language is one the app supports', () => {
    for (const c of COUNTRIES) {
      expect(SUPPORTED_LANGUAGES).toContain(c.language);
    }
  });

  it('startOfWeek returns Monday when firstDayOfWeek is 1', () => {
    // Wed 2026-03-04 -> week starting Mon 2026-03-02
    const start = startOfWeek('2026-03-04', 1);
    expect(start.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(start.getDay()).toBe(1);
  });

  it('startOfWeek returns Sunday when firstDayOfWeek is 0', () => {
    // Wed 2026-03-04 -> week starting Sun 2026-03-01
    const start = startOfWeek('2026-03-04', 0);
    expect(start.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(start.getDay()).toBe(0);
  });

  it('startOfWeek of a Monday with firstDayOfWeek 1 is itself', () => {
    const start = startOfWeek('2026-03-02', 1);
    expect(start.toISOString().slice(0, 10)).toBe('2026-03-02');
  });

  it('formatDateByConvention respects DMY/MDY/YMD', () => {
    const d = new Date(2026, 2, 5); // 5 March 2026
    expect(formatDateByConvention(d, 'DMY')).toBe('05/03/2026');
    expect(formatDateByConvention(d, 'MDY')).toBe('03/05/2026');
    expect(formatDateByConvention(d, 'YMD')).toBe('2026-03-05');
  });

  it('firstDayOfWeek uses 0=Sunday..6=Saturday and matches expectations', () => {
    // Convention: 0 = Sunday .. 6 = Saturday (JS Date.getDay()).
    const mondayFirst = ['PT', 'GB', 'IE', 'ES', 'FR', 'DE', 'AU', 'JP', 'CH'];
    const sundayFirst = ['BR', 'US', 'CA', 'MX', 'AR'];
    for (const code of mondayFirst) {
      expect(getCountry(code)?.firstDayOfWeek).toBe(1); // Monday
    }
    for (const code of sundayFirst) {
      expect(getCountry(code)?.firstDayOfWeek).toBe(0); // Sunday
    }
    for (const c of COUNTRIES) {
      expect(c.firstDayOfWeek).toBeGreaterThanOrEqual(0);
      expect(c.firstDayOfWeek).toBeLessThanOrEqual(6);
    }
  });
});
