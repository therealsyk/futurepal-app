// Funções do MyFuturePal Plus/Pro: Modo IRS, caçador de subscrições, previsão do mês,
// "o teu ano em números", desafios de poupança, garantias e despesas profissionais.
// Tudo puro (sem base de dados) para poder ser testado; as páginas passam os dados.
import type { Category, Transaction } from '../db/database';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86_400_000);
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return iso(x); };
const expenses = (txs: Transaction[]) => txs.filter((t) => t.type === 'expense' && t.deletedAt === null);

// ---------------------------------------------------------------- Modo IRS
// Organiza as despesas pelas deduções do IRS (Portugal). Valores indicativos: confirmar no Portal das Finanças.
export type IrsGroup = 'general' | 'health' | 'education' | 'housing' | 'vat';
export const IRS_RULES: Record<IrsGroup, { keys: string[]; rate: number | null; capCents: number | null }> = {
  general: { keys: ['catGroceries', 'catElectricity', 'catWater', 'catInternet', 'catTelephone', 'catTv', 'catHomeSupplies', 'catClothes', 'catShopping', 'catGas', 'catBills'], rate: 0.35, capCents: 25_000 },
  health: { keys: ['catHealth', 'catDoctor', 'catDentist', 'catPharmacy'], rate: 0.15, capCents: 100_000 },
  education: { keys: ['catEducation', 'catChildCare'], rate: 0.3, capCents: 80_000 },
  housing: { keys: ['catRent'], rate: 0.15, capCents: null },
  vat: { keys: ['catFood', 'catCoffee', 'catHotel', 'catRepair', 'catAnimals', 'catSports'], rate: null, capCents: null },
};
export interface IrsLine { group: IrsGroup; totalCents: number; count: number; estimateCents: number | null; capCents: number | null }

export function irsSummary(txs: Transaction[], cats: Category[], year: number): IrsLine[] {
  const keyOf = new Map(cats.map((c) => [c.id, c.nameKey ?? '']));
  const y = String(year);
  return (Object.keys(IRS_RULES) as IrsGroup[]).map((group) => {
    const r = IRS_RULES[group];
    const list = expenses(txs).filter((t) => t.date.startsWith(y) && r.keys.includes(keyOf.get(t.categoryId) ?? ''));
    const totalCents = list.reduce((s, t) => s + t.amountCents, 0);
    const raw = r.rate === null ? null : Math.round(totalCents * r.rate);
    return { group, totalCents, count: list.length, capCents: r.capCents, estimateCents: raw === null ? null : r.capCents === null ? raw : Math.min(raw, r.capCents) };
  });
}
/** Prazo para validar faturas no e-Fatura (25 de fevereiro do ano seguinte). */
export function efaturaDeadline(year: number): string { return `${year + 1}-02-25`; }

// ---------------------------------------------------------------- caçador de subscrições
export type SubFrequency = 'weekly' | 'monthly' | 'yearly';
export interface Subscription { key: string; name: string; categoryId: string; amountCents: number; frequency: SubFrequency; annualCents: number; lastDate: string; nextDate: string; daysUntil: number; count: number }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[0-9#*/.\-_,]+/g, ' ').replace(/\s+/g, ' ').trim();
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** Pagamentos que se repetem com valor parecido (±15%) e intervalo regular. */
export function detectSubscriptions(txs: Transaction[], today = new Date()): Subscription[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of expenses(txs)) {
    const k = norm(t.description || '') || `cat:${t.categoryId}:${t.amountCents}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const todayIso = iso(today);
  const out: Subscription[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amounts = list.map((t) => t.amountCents);
    const med = median(amounts);
    if (amounts.some((a) => Math.abs(a - med) > med * 0.15)) continue;
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date));
    const g = median(gaps);
    const frequency: SubFrequency | null = g >= 6 && g <= 8 ? 'weekly' : g >= 25 && g <= 35 ? 'monthly' : g >= 350 && g <= 380 ? 'yearly' : null;
    if (!frequency || gaps.some((x) => Math.abs(x - g) > (frequency === 'weekly' ? 2 : 6))) continue;
    const last = list[list.length - 1];
    let next = addDays(last.date, frequency === 'weekly' ? 7 : frequency === 'monthly' ? 30 : 365);
    if (frequency === 'monthly') { const d = new Date(last.date + 'T12:00:00'); d.setMonth(d.getMonth() + 1); next = iso(d); }
    const per = frequency === 'weekly' ? 52 : frequency === 'monthly' ? 12 : 1;
    out.push({ key, name: last.description || key, categoryId: last.categoryId, amountCents: last.amountCents, frequency, annualCents: last.amountCents * per, lastDate: last.date, nextDate: next, daysUntil: daysBetween(todayIso, next), count: list.length });
  }
  return out.sort((a, b) => b.annualCents - a.annualCents);
}

// ---------------------------------------------------------------- previsão do mês
export interface MonthForecast { projectedSpendCents: number; projectedBalanceCents: number; daysLeft: number }
/** Só faz sentido no mês corrente: projeta o gasto ao ritmo atual até ao fim do mês. */
export function monthForecast(spentCents: number, incomeCents: number, year: number, month: number, today = new Date()): MonthForecast | null {
  if (today.getFullYear() !== year || today.getMonth() + 1 !== month) return null;
  const days = new Date(year, month, 0).getDate();
  const day = today.getDate();
  const projectedSpendCents = Math.round((spentCents / day) * days);
  return { projectedSpendCents, projectedBalanceCents: incomeCents - projectedSpendCents, daysLeft: days - day };
}

// ---------------------------------------------------------------- o teu ano em números
export interface YearReview {
  spentCents: number; incomeCents: number; savedCents: number; count: number; avgPerDayCents: number;
  topCategory: { categoryId: string; cents: number } | null;
  priciestDay: { date: string; cents: number } | null;
  cheapestMonth: { month: number; cents: number } | null; priciestMonth: { month: number; cents: number } | null;
  coffeeCount: number; coffeeCents: number;
}
export function yearReview(txs: Transaction[], cats: Category[], year: number, salaryCents = 0, today = new Date()): YearReview {
  const y = String(year);
  const list = txs.filter((t) => t.deletedAt === null && t.date.startsWith(y));
  const exp = list.filter((t) => t.type === 'expense');
  const spentCents = exp.reduce((s, t) => s + t.amountCents, 0);
  const incomeCents = salaryCents + list.filter((t) => t.type === 'income' && !t.id.startsWith('sal-')).reduce((s, t) => s + t.amountCents, 0);
  const byCat = new Map<string, number>(), byDay = new Map<string, number>(), byMonth = new Map<number, number>();
  for (const t of exp) {
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amountCents);
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amountCents);
    const m = Number(t.date.slice(5, 7));
    byMonth.set(m, (byMonth.get(m) ?? 0) + t.amountCents);
  }
  const top = <K,>(m: Map<K, number>, dir = 1) => [...m.entries()].sort((a, b) => dir * (b[1] - a[1]))[0];
  const tc = top(byCat), pd = top(byDay), pm = top(byMonth), cm = top(byMonth, -1);
  const coffeeIds = new Set(cats.filter((c) => c.nameKey === 'catCoffee').map((c) => c.id));
  const coffee = exp.filter((t) => coffeeIds.has(t.categoryId));
  const lastDay = year === today.getFullYear() ? today : new Date(year, 11, 31);
  const days = Math.max(1, Math.floor((lastDay.getTime() - new Date(year, 0, 1).getTime()) / 86_400_000) + 1);
  return {
    spentCents, incomeCents, savedCents: incomeCents - spentCents, count: exp.length, avgPerDayCents: Math.round(spentCents / days),
    topCategory: tc ? { categoryId: tc[0], cents: tc[1] } : null,
    priciestDay: pd ? { date: pd[0], cents: pd[1] } : null,
    priciestMonth: pm ? { month: pm[0], cents: pm[1] } : null,
    cheapestMonth: cm ? { month: cm[0], cents: cm[1] } : null,
    coffeeCount: coffee.length, coffeeCents: coffee.reduce((s, t) => s + t.amountCents, 0),
  };
}

// ---------------------------------------------------------------- desafios de poupança
export type ChallengeType = 'noTakeaway' | 'noShopping' | 'coffeeCut' | 'week52';
export interface Challenge { id: string; type: ChallengeType; startDate: string; weeksDone: number[] }
export interface ChallengeStatus { status: 'active' | 'won' | 'lost'; progress: number; endDate: string; spentCents: number; savedCents: number }
export const CHALLENGE_DEFS: Record<ChallengeType, { days: number; keys: string[] }> = {
  noTakeaway: { days: 30, keys: ['catFood'] },
  noShopping: { days: 7, keys: ['catShopping', 'catClothes'] },
  coffeeCut: { days: 30, keys: ['catCoffee'] },
  week52: { days: 364, keys: [] },
};
export function evaluateChallenge(ch: Challenge, txs: Transaction[], cats: Category[], today = new Date()): ChallengeStatus {
  const def = CHALLENGE_DEFS[ch.type];
  const endDate = addDays(ch.startDate, def.days - 1);
  const todayIso = iso(today);
  const elapsed = Math.min(def.days, Math.max(0, daysBetween(ch.startDate, todayIso) + 1));
  const finished = todayIso > endDate;
  if (ch.type === 'week52') {
    const savedCents = ch.weeksDone.reduce((s, w) => s + w * 100, 0);
    return { status: ch.weeksDone.length >= 52 ? 'won' : 'active', progress: ch.weeksDone.length / 52, endDate, spentCents: 0, savedCents };
  }
  const ids = new Set(cats.filter((c) => def.keys.includes(c.nameKey ?? '')).map((c) => c.id));
  const inRange = (t: Transaction, a: string, b: string) => t.date >= a && t.date <= b && ids.has(t.categoryId);
  const spentCents = expenses(txs).filter((t) => inRange(t, ch.startDate, endDate)).reduce((s, t) => s + t.amountCents, 0);
  if (ch.type === 'coffeeCut') {
    // gastar em café menos de metade do que nos 30 dias anteriores ao início
    const before = expenses(txs).filter((t) => inRange(t, addDays(ch.startDate, -30), addDays(ch.startDate, -1))).reduce((s, t) => s + t.amountCents, 0);
    const limit = Math.round(before / 2);
    const lost = before > 0 ? spentCents > limit : false;
    return { status: lost ? 'lost' : finished ? 'won' : 'active', progress: elapsed / def.days, endDate, spentCents, savedCents: Math.max(0, before - spentCents) };
  }
  const lost = spentCents > 0;
  return { status: lost ? 'lost' : finished ? 'won' : 'active', progress: elapsed / def.days, endDate, spentCents, savedCents: 0 };
}

// ---------------------------------------------------------------- garantias
export function warrantyEnd(purchaseDate: string, months: number): string {
  const d = new Date(purchaseDate + 'T12:00:00'); d.setMonth(d.getMonth() + months); return iso(d);
}
export function warrantyDaysLeft(purchaseDate: string, months: number, today = new Date()): number {
  return daysBetween(iso(today), warrantyEnd(purchaseDate, months));
}

// ---------------------------------------------------------------- independentes (despesas profissionais)
export interface QuarterTotals { quarter: number; incomeCents: number; expenseCents: number; count: number }
export function businessQuarters(txs: Transaction[], businessIds: Set<string>, year: number): QuarterTotals[] {
  const out = [1, 2, 3, 4].map((quarter) => ({ quarter, incomeCents: 0, expenseCents: 0, count: 0 }));
  for (const t of txs) {
    if (t.deletedAt !== null || !businessIds.has(t.id) || !t.date.startsWith(String(year))) continue;
    const q = out[Math.floor((Number(t.date.slice(5, 7)) - 1) / 3)];
    if (t.type === 'income') q.incomeCents += t.amountCents; else q.expenseCents += t.amountCents;
    q.count += 1;
  }
  return out;
}
/** CSV para o contabilista (separador ";" para abrir bem no Excel em português). */
export function businessCsv(txs: Transaction[], businessIds: Set<string>, catName: (id: string) => string, year: number): string {
  const rows = txs.filter((t) => t.deletedAt === null && businessIds.has(t.id) && t.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date));
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ['Data;Tipo;Categoria;Descrição;Valor'];
  for (const t of rows) lines.push([t.date, t.type === 'income' ? 'Rendimento' : 'Despesa', esc(catName(t.categoryId)), esc(t.description || ''), (t.amountCents / 100).toFixed(2).replace('.', ',')].join(';'));
  return lines.join('\n');
}
