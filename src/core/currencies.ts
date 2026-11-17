// Lista de moedas para o seletor (nomes traduzidos pelo próprio browser via Intl).

export const CURRENCY_CODES = [
  'EUR', 'USD', 'GBP', 'BRL', 'CHF', 'CAD', 'AUD', 'JPY', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
  'BGN', 'ALL', 'TRY', 'UAH', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'UYU', 'AOA', 'MZN', 'CVE', 'ZAR', 'MAD', 'EGP',
  'NGN', 'KES', 'INR', 'IDR', 'THB', 'VND', 'PHP', 'MYR', 'SGD', 'HKD', 'KRW', 'TWD', 'NZD', 'AED', 'SAR', 'ILS', 'QAR',
];

export function currencyName(code: string, language: string): string {
  try {
    const dn = new Intl.DisplayNames([language], { type: 'currency' });
    const n = dn.of(code);
    if (n) return n.charAt(0).toUpperCase() + n.slice(1);
  } catch { /* Intl sem DisplayNames */ }
  return code;
}

export function currencySymbol(code: string, language: string): string {
  try {
    const parts = new Intl.NumberFormat(language, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

export interface CurrencyGroup { letter: string; items: Array<{ code: string; name: string }> }

// Agrupa por letra inicial do nome (como uma lista de contactos) e filtra pela pesquisa.
export function groupCurrencies(language: string, query = ''): CurrencyGroup[] {
  const q = query.trim().toLowerCase();
  const items = CURRENCY_CODES
    .map((code) => ({ code, name: currencyName(code, language) }))
    .filter((c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, language));
  const groups: CurrencyGroup[] = [];
  for (const it of items) {
    const letter = it.name.charAt(0).toUpperCase();
    const g = groups[groups.length - 1];
    if (g && g.letter === letter) g.items.push(it);
    else groups.push({ letter, items: [it] });
  }
  return groups;
}
