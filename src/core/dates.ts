// Datas como texto 'YYYY-MM-DD' no fuso do utilizador, sem surpresas de UTC.
// Regra: nunca usar new Date().toISOString().slice(0, 10) para "hoje" (isso é a data em UTC)
// nem endOfMonth(new Date(Date.UTC(...))) (mistura UTC com hora local e falha em fusos negativos).

const pad = (n: number) => String(n).padStart(2, '0');

/** Data local de um Date, como 'YYYY-MM-DD'. */
export function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hoje, no fuso do utilizador. */
export function todayISO(): string {
  return toLocalISO(new Date());
}

/** Número de dias de um mês (month 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Primeiro dia do mês, 'YYYY-MM-01'. */
export function monthStart(year: number, month: number): string {
  return `${year}-${pad(month)}-01`;
}

/** Último dia do mês, 'YYYY-MM-DD' (28/29/30/31), independente do fuso. */
export function monthEnd(year: number, month: number): string {
  return `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
}

/** Soma meses a uma data local; o dia é limitado ao fim do mês (31 jan + 1 mês = 28/29 fev). */
export function addMonthsISO(date: Date, months: number): string {
  const y = date.getFullYear();
  const m = date.getMonth() + months;
  const target = new Date(y, m, 1);
  const day = Math.min(date.getDate(), daysInMonth(target.getFullYear(), target.getMonth() + 1));
  return toLocalISO(new Date(target.getFullYear(), target.getMonth(), day));
}
