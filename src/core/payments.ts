// Pagamentos recorrentes: os que a pessoa adicionou e os que se repetem nas despesas (subscrições, contas da casa, ginásio…).
// Tudo puro (sem base de dados) para poder ser testado; a página e o aviso passam os dados.
import type { Category, Recurring, RecurringFrequency, Transaction } from '../db/database';
import { advanceDate, monthlyEquivalentCents } from './finance';

export interface Payment {
  key: string;
  name: string;
  categoryId: string;
  cents: number; // quanto sai de cada vez
  frequency: RecurringFrequency;
  monthlyCents: number;
  nextDate: string;
  daysUntil: number;
  recId?: string; // adicionado como recorrente; sem isto, foi detetado nas despesas
  accountId?: string;
  endDate?: string | null;
  sure: boolean; // repetiu-se vezes suficientes para perguntar se a pessoa o quer adicionar
  hits: Array<{ date: string; cents: number }>; // vezes em que já saiu dinheiro
}

const day = 86_400_000;
const at = (d: string) => new Date(d + 'T12:00:00').getTime();
const between = (a: string, b: string) => Math.round((at(b) - at(a)) / day);
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
/** "NETFLIX.COM 0815/PT" e "Netflix com" são o mesmo. */
export const payKey = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[0-9#*/.\-_,:()]+/g, ' ').replace(/\b(compra|pagamento|pag|deb|debito|direto|dd|cartao|visa|mb|ref)\b/g, ' ').replace(/\s+/g, ' ').trim();

// intervalo entre pagamentos (dias): de, até, folga, quantas vezes para ter a certeza
const STEPS: Array<[RecurringFrequency, number, number, number, number]> = [
  ['weekly', 6, 8, 2, 4], ['biweekly', 13, 16, 3, 4], ['monthly', 26, 35, 6, 3], ['bimonthly', 55, 67, 8, 3], ['quarterly', 85, 98, 10, 3], ['semiannual', 172, 192, 14, 2], ['yearly', 350, 381, 16, 2],
];

/** Despesas que se repetem com valor parecido e intervalo regular, e que ainda parecem estar ativas. */
export function detectPayments(txs: Transaction[], today = new Date()): Payment[] {
  const now = isoDay(today), groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.deletedAt !== null || t.type !== 'expense' || t.date > now) continue;
    const k = payKey(t.description || '') || `cat:${t.categoryId}:${t.amountCents}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: Payment[] = [];
  for (const [key, all] of groups) {
    const list = all.sort((a, b) => a.date.localeCompare(b.date));
    if (list.length < 2) continue;
    const med = median(list.map((t) => t.amountCents)), tol = serviceOf(key)?.varies ? 0.5 : 0.15;
    if (list.some((t) => Math.abs(t.amountCents - med) > med * tol)) continue;
    const gaps = list.slice(1).map((t, i) => between(list[i].date, t.date)), g = median(gaps);
    const step = STEPS.find(([, a, b]) => g >= a && g <= b);
    if (!step || gaps.some((x) => Math.abs(x - g) > step[3])) continue;
    const last = list[list.length - 1], next = advanceDate(last.date, step[0]), until = between(now, next);
    if (until < -Math.max(7, Math.round(g * 0.6))) continue; // já deixou de sair
    out.push({ key, name: (last.description || '').trim() || key, categoryId: last.categoryId, cents: last.amountCents, frequency: step[0], monthlyCents: monthlyEquivalentCents(last.amountCents, step[0]), nextDate: next, daysUntil: until, accountId: last.accountId, sure: list.length >= step[4], hits: list.map((t) => ({ date: t.date, cents: t.amountCents })) });
  }
  return out;
}

/** Os adicionados pela pessoa e, à parte, os detetados que ainda não estão adicionados nem foram recusados. */
export function allPayments(txs: Transaction[], recs: Recurring[], ignored: string[], today = new Date()): { added: Payment[]; found: Payment[] } {
  const now = isoDay(today);
  const mine = recs.filter((r) => r.deletedAt === null && r.type === 'expense' && !r.toAccountId && (!r.endDate || r.endDate >= now));
  const added = mine.map((r): Payment => {
    const k = payKey(r.description);
    const hits = txs.filter((t) => t.deletedAt === null && t.type === 'expense' && (t.recurringId === r.id || (!!k && payKey(t.description || '') === k))).map((t) => ({ date: t.date, cents: t.amountCents }));
    return { key: k || r.id, name: r.description, categoryId: r.categoryId, cents: r.amountCents, frequency: r.frequency, monthlyCents: monthlyEquivalentCents(r.amountCents, r.frequency), nextDate: r.nextDate, daysUntil: between(now, r.nextDate), recId: r.id, accountId: r.accountId, endDate: r.endDate, sure: true, hits };
  });
  const keys = new Set(mine.map((r) => payKey(r.description)).filter(Boolean)), ids = new Set(recs.map((r) => r.id)), skip = new Set(ignored);
  const auto = new Set(txs.filter((t) => t.recurringId && ids.has(t.recurringId)).map((t) => payKey(t.description || '') || `cat:${t.categoryId}:${t.amountCents}`));
  const found = detectPayments(txs, today).filter((p) => !skip.has(p.key) && !keys.has(p.key) && !auto.has(p.key)
    && !mine.some((r) => r.categoryId === p.categoryId && r.frequency === p.frequency && Math.abs(r.amountCents - p.cents) <= p.cents * 0.02));
  const big = (a: Payment, b: Payment) => b.monthlyCents - a.monthlyCents;
  return { added: added.sort(big), found: found.sort(big) };
}

/** Quanto já saiu e quanto ainda vai sair num intervalo de datas. */
export function inPeriod(p: Payment, from: string, to: string, today = new Date()): { paid: number; due: number } {
  const now = isoDay(today), paid = p.hits.filter((h) => h.date >= from && h.date <= to).reduce((a, h) => a + h.cents, 0);
  let due = 0, d = p.nextDate;
  for (let n = 0; n < 400 && d <= to; n++) { if (d >= now && d >= from && (!p.endDate || d <= p.endDate)) due += p.cents; d = advanceDate(d, p.frequency); }
  return { paid, due };
}

/** Próxima data a partir de hoje (para não criar pagamentos já passados ao adicionar). */
export function nextFrom(p: Payment, today = new Date()): string {
  const now = isoDay(today);
  let d = p.nextDate;
  for (let n = 0; n < 400 && d < now; n++) d = advanceDate(d, p.frequency);
  return d;
}

// ── que tipo de serviço é (pelo nome) e se é essencial
export type ServiceKind = 'stream' | 'music' | 'games' | 'cloud' | 'gym' | 'phone' | 'energy' | 'water' | 'insurance' | 'home' | 'loan' | 'news' | 'shop';
const SERVICES: Array<[ServiceKind, RegExp, boolean?, boolean?]> = [
  ['stream', /netflix|disney|hbo|\bmax\b|prime video|apple tv|skyshowtime|sky show|opto|filmin|crunchyroll|youtube|paramount|dazn|sport tv|twitch|hulu/],
  ['music', /spotify|apple music|tidal|deezer|audible|soundcloud|storytel/],
  ['games', /playstation|psn|xbox|game pass|nintendo|steam|ea play|ubisoft|roblox/],
  ['cloud', /icloud|google one|google storage|dropbox|onedrive|microsoft|office|adobe|canva|notion|chatgpt|openai|claude|anthropic|github|nordvpn|vpn|antivirus|duolingo|linkedin|apple com|itunes/],
  ['gym', /ginasio|gym|fitness|solinca|holmes|crossfit|piscina|academia/],
  ['phone', /\bmeo\b|\bnos\b|vodafone|nowo|digi|\bwoo\b|uzo|telecom|internet|telemovel|movistar|orange|claro|\bvivo\b/, true],
  ['energy', /\bedp\b|endesa|galp|iberdrola|goldenergy|eletricidade|luz\b|energia|\bgas\b|naturgy|repsol/, true, true],
  ['water', /\bagua|aguas|smas|epal|saneamento/, true, true],
  ['insurance', /seguro|fidelidade|ageas|allianz|tranquilidade|generali|zurich|medis|multicare|insurance/, true],
  ['home', /renda|rent\b|condominio|hipoteca|alquiler|loyer|aluguer/, true],
  ['loan', /credito|emprestimo|prestacao|loan|cetelem|cofidis|prestamo/, true],
  ['news', /expresso|publico|observador|jornal|revista|medium|substack|new york times/],
  ['shop', /amazon|prime\b|uber one|glovo|bolt plus|continente|too good|hellofresh|patreon|onlyfans/],
];
export function serviceOf(name: string): { kind: ServiceKind; essential: boolean; varies: boolean } | null {
  const k = payKey(name), s = SERVICES.find(([, re]) => re.test(k));
  return s ? { kind: s[0], essential: !!s[2], varies: !!s[3] } : null;
}
const ESSENTIAL = new Set(['catRent', 'catElectricity', 'catWater', 'catGas', 'catInternet', 'catTelephone', 'catHealth', 'catDoctor', 'catPharmacy', 'catInsurance', 'catCarInsurance', 'catEducation', 'catChildCare', 'catTaxes', 'catLoan', 'catMortgage', 'catStudentLoan', 'catCarLoan', 'catDentist', 'catBills', 'catHome', 'catBankFees']);
/** Essencial = não faz sentido sugerir cancelar (renda, luz, água, seguros…). */
export const isEssential = (p: Payment, cat?: Category): boolean => serviceOf(p.name)?.essential ?? ESSENTIAL.has(cat?.nameKey ?? '');
