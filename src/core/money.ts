// Pure money helpers. Money is ALWAYS integer cents + ISO currency (SPEC §2). Never float.

export function assertCents(n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`amountCents must be a non-negative integer, got ${n}`);
  }
}

// Formats cents for display only (divides by 100 here, never in storage).
// Display values like net/savings can be negative, so we only require an integer.
export function formatMoney(cents: number, currency: string, locale: string): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatMoney expects an integer cents value, got ${cents}`);
  }
  const noFraction = ['JPY', 'KRW', 'VND', 'IDR'].includes(currency.toUpperCase());
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: noFraction ? 0 : 2,
    maximumFractionDigits: noFraction ? 0 : 2,
  }).format(cents / 100);
}

// Parses user input like "12,50" or "1 234.56" to integer cents WITHOUT float.
// Rejects more than 2 decimal places. Returns null if invalid.
export function parseMoneyToCents(input: string): number | null {
  const s = String(input).trim();
  if (!s) return null;

  // Normalize thousands separators: remove spaces and dots used as thousands (pt-PT style "1.234,50").
  // Heuristic: if both '.' and ',' exist, the LAST one is the decimal separator.
  let normalized = s.replace(/\s/g, '');
  const hasDot = normalized.includes('.');
  const hasComma = normalized.includes(',');

  if (hasDot && hasComma) {
    // The later occurrence is the decimal separator; remove the other as thousands.
    const lastDecimal = normalized.lastIndexOf('.') > normalized.lastIndexOf(',') ? '.' : ',';
    const thousands = lastDecimal === '.' ? ',' : '.';
    normalized = normalized.split(thousands).join('').replace(lastDecimal, '.');
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  }

  // After normalization: optional minus and at most one dot with <=2 digits.
  const m = /^-?\d+(\.\d{1,2})?$/.exec(normalized);
  if (!m) return null;

  const negative = normalized.startsWith('-');
  const body = normalized.replace('-', '');
  const [intPart, fracPart] = body.split('.');
  const cents = parseInt(intPart, 10) * 100 + (fracPart ? parseInt(fracPart.padEnd(2, '0'), 10) : 0);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}
