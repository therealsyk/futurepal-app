// Pure logic: country/currency/locale helpers. No React, no DOM.

export interface CountryInfo {
  code: string; // ISO 3166-1 alpha-2
  currency: string; // ISO 4217
  language: string; // i18n key used by the app (pt-PT, pt-BR, en, es, fr)
  firstDayOfWeek: number; // 0 = Sunday .. 6 = Saturday (matches JS Date.getDay())
  dateFormat: 'DMY' | 'MDY' | 'YMD';
}

// firstDayOfWeek convention: 0 = Sunday .. 6 = Saturday (JS Date.getDay()).
export const COUNTRIES: CountryInfo[] = [
  { code: 'PT', currency: 'EUR', language: 'pt-PT', firstDayOfWeek: 1, dateFormat: 'DMY' },
  { code: 'BR', currency: 'BRL', language: 'pt-BR', firstDayOfWeek: 0, dateFormat: 'DMY' },
  { code: 'US', currency: 'USD', language: 'en', firstDayOfWeek: 0, dateFormat: 'MDY' },
  { code: 'GB', currency: 'GBP', language: 'en', firstDayOfWeek: 1, dateFormat: 'DMY' },
  { code: 'IE', currency: 'EUR', language: 'en', firstDayOfWeek: 1, dateFormat: 'DMY' },
  { code: 'ES', currency: 'EUR', language: 'es', firstDayOfWeek: 1, dateFormat: 'DMY' },
  { code: 'FR', currency: 'EUR', language: 'fr', firstDayOfWeek: 1, dateFormat: 'DMY' },
  { code: 'DE', currency: 'EUR', language: 'en', firstDayOfWeek: 1, dateFormat: 'DMY' },
  { code: 'CA', currency: 'CAD', language: 'en', firstDayOfWeek: 0, dateFormat: 'MDY' },
  { code: 'AU', currency: 'AUD', language: 'en', firstDayOfWeek: 1, dateFormat: 'DMY' },
  { code: 'MX', currency: 'MXN', language: 'es', firstDayOfWeek: 0, dateFormat: 'DMY' },
  { code: 'AR', currency: 'ARS', language: 'es', firstDayOfWeek: 0, dateFormat: 'DMY' },
  { code: 'JP', currency: 'JPY', language: 'en', firstDayOfWeek: 1, dateFormat: 'YMD' },
  { code: 'CH', currency: 'CHF', language: 'en', firstDayOfWeek: 1, dateFormat: 'DMY' },
];

export function getCountry(code: string): CountryInfo | undefined {
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}

// Currencies without fractional units (JPY, etc.). Amounts are still stored in cents internally.
// Uma só implementação de formatMoney (core/money.ts); reexportada aqui por compatibilidade.
export { formatMoney } from './money';

export function formatDate(date: Date | string, locale: string): string {
  const d = typeof date === 'string' ? new Date(date + (date.length === 10 ? 'T00:00:00' : '')) : date;
  return new Intl.DateTimeFormat(locale).format(d);
}

// Returns the ISO date of the first day of the week containing `date`,
// using firstDayOfWeek (0 = Sunday .. 6 = Saturday). Pure logic for calendar UI.
export function startOfWeek(date: Date | string, firstDayOfWeek: number): Date {
  const d = typeof date === 'string' ? new Date(date + (date.length === 10 ? 'T00:00:00' : '')) : new Date(date);
  const day = d.getDay();
  const offset = (day - firstDayOfWeek + 7) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  return start;
}

// Formats a date according to the country's dateFormat convention (DMY/MDY/YMD).
export function formatDateByConvention(date: Date | string, format: 'DMY' | 'MDY' | 'YMD'): string {
  const d = typeof date === 'string' ? new Date(date + (date.length === 10 ? 'T00:00:00' : '')) : date;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  if (format === 'YMD') return `${yyyy}-${mm}-${dd}`;
  if (format === 'MDY') return `${mm}/${dd}/${yyyy}`;
  return `${dd}/${mm}/${yyyy}`;
}

export function countryName(code: string, locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: 'region' });
    return display.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
