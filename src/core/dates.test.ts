import { describe, it, expect } from 'vitest';
import { toLocalISO, monthEnd, monthStart, daysInMonth, addMonthsISO } from './dates';

describe('dates', () => {
  it('toLocalISO uses local fields (not UTC)', () => {
    expect(toLocalISO(new Date(2026, 10, 17, 23, 59))).toBe('2026-11-17');
    expect(toLocalISO(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });

  it('monthEnd handles 30/31 days and leap years', () => {
    expect(monthEnd(2026, 11)).toBe('2026-11-30');
    expect(monthEnd(2026, 12)).toBe('2026-12-31');
    expect(monthEnd(2026, 2)).toBe('2026-02-28');
    expect(monthEnd(2028, 2)).toBe('2028-02-29');
    expect(monthStart(2026, 3)).toBe('2026-03-01');
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('addMonthsISO crosses years and clamps the day', () => {
    expect(addMonthsISO(new Date(2026, 9, 15), 3)).toBe('2027-01-15'); // outubro + 3 = janeiro do ano seguinte
    expect(addMonthsISO(new Date(2026, 10, 30), 3)).toBe('2027-02-28');
    expect(addMonthsISO(new Date(2026, 0, 31), 1)).toBe('2026-02-28');
    expect(addMonthsISO(new Date(2026, 5, 10), -6)).toBe('2025-12-10');
  });
});
