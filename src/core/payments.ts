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
export const payKey = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[0-9#*/.\-_,:()]+/g, ' ').replace(/\b(compras?|pagamentos?|pagto|pag|deb|debito|direto|directo|sepa|dd|cartao|card|visa|mastercard|contactless|mb|mbway|way|ref|trf|transf|transferencia|para|de|do|da|em|a|no|lisboa|porto|portugal|prt|pt|lda|sa|com|www|https?|payment|purchase|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/g, ' ').replace(/\s+/g, ' ').trim();

// intervalo entre pagamentos (dias): de, até, folga, quantas vezes para ter a certeza
const STEPS: Array<[RecurringFrequency, number, number, number, number]> = [
  ['weekly', 6, 8, 2, 4], ['biweekly', 13, 16, 3, 4], ['monthly', 26, 35, 6, 3], ['bimonthly', 55, 67, 8, 3], ['quarterly', 85, 98, 10, 3], ['semiannual', 172, 192, 14, 2], ['yearly', 350, 381, 16, 2],
];

/** Junta valores parecidos (o mesmo comerciante pode ter a subscrição e compras soltas). */
function clusters(list: Transaction[], tol: number): Transaction[][] {
  const out: Transaction[][] = [];
  for (const t of [...list].sort((a, b) => a.amountCents - b.amountCents)) {
    const c = out.find((x) => Math.abs(t.amountCents - median(x.map((y) => y.amountCents))) <= Math.max(100, median(x.map((y) => y.amountCents)) * tol));
    if (c) c.push(t); else out.push([t]);
  }
  return out;
}

/** Padrão de uma lista do mesmo pagamento: aceita um mês falhado e alguns dias de diferença. ref = até quando há dados. */
function pattern(key: string, all: Transaction[], ref: string, now: string): Payment | null {
  const list = [...all].sort((a, b) => a.date.localeCompare(b.date)).filter((t, i, xs) => i === 0 || between(xs[i - 1].date, t.date) > 2);
  if (list.length < 2) return null;
  const gaps = list.slice(1).map((t, i) => between(list[i].date, t.date)), g = median(gaps);
  const step = STEPS.find(([, a, b]) => g >= a && g <= b) ?? STEPS.find(([, a, b]) => Math.min(...gaps) >= a && Math.min(...gaps) <= b && gaps.length > 1);
  if (!step) return null;
  const mid = (step[1] + step[2]) / 2, ok = gaps.filter((x) => [1, 2].some((k) => Math.abs(x - mid * k) <= step[3] * k)).length;
  if (ok / gaps.length < (step[0] === 'weekly' || step[0] === 'biweekly' ? 0.8 : 0.66)) return null;
  const last = list[list.length - 1];
  if (between(last.date, ref) > mid * 1.6 + 5) return null; // já deixou de sair
  let next = advanceDate(last.date, step[0]);
  for (let n = 0; n < 60 && next < now && between(next, now) > mid * 0.6; n++) next = advanceDate(next, step[0]);
  return { key, name: (last.description || '').trim() || key, categoryId: last.categoryId, cents: last.amountCents, frequency: step[0], monthlyCents: monthlyEquivalentCents(last.amountCents, step[0]), nextDate: next, daysUntil: between(now, next), accountId: last.accountId, sure: list.length >= step[4], hits: list.map((t) => ({ date: t.date, cents: t.amountCents })) };
}

// categorias de gasto variável: só contam como recorrentes se forem mesmo regulares (semanal/mensal, valor quase igual, 4+ vezes)
const VARIABLE_CAT = /cat-(catGas|catGroceries|catFood|catCoffee|catDrinks|catCandy|catTransport|catTaxi|catParking|catShopping|catClothes|catLeisure|catNightlife|catHobby|catLifestyle|catGift|catAnimals|catPharmacy|catHomeSupplies|catRepair|catMaintenance|catTravel|catHotel|catFlight|catVacation|catOther|catUnknown)$/;
const LONG: RecurringFrequency[] = ['bimonthly', 'quarterly', 'semiannual', 'yearly'];
/** Rejeita padrões que não fazem sentido como pagamento recorrente (ex.: 10 € de gasolina "a cada 6 meses"). */
function plausible(p: Payment, cluster: number, merchant: number): boolean {
  const svc = serviceOf(p.name), known = !!svc && !(svc.kind === 'energy' && /cat-catGas$/.test(p.categoryId)); // "Galp" em Combustível é bomba, não a conta do gás
  const spread = (() => { const v = p.hits.map((h) => h.cents), mx = Math.max(...v), mn = Math.min(...v); return mx > 0 ? (mx - mn) / mx : 0; })();
  if (VARIABLE_CAT.test(p.categoryId) && !known) {
    if (LONG.includes(p.frequency)) return false;
    if (p.hits.length < 4 || spread > 0.05) return false;
  }
  if (LONG.includes(p.frequency)) {
    if (!known && p.cents < 2000) return false; // valores pequenos com meses de intervalo: quase sempre coincidência
    if (!known && p.hits.length < 3) return false;
    if (merchant > 0 && cluster / merchant < 0.6) return false; // o mesmo sítio tem muitas outras compras soltas
  }
  return true;
}

/** Despesas que se repetem com valor parecido e intervalo regular, e que ainda parecem estar ativas. */
export function detectPayments(txs: Transaction[], today = new Date()): Payment[] {
  const now = isoDay(today), exp = txs.filter((t) => t.deletedAt === null && t.type === 'expense' && t.date <= now);
  if (!exp.length) return [];
  // os movimentos podem só ir até ao último extrato importado: "ativo" mede-se a partir daí
  const lastDay = exp.reduce((a, t) => (t.date > a ? t.date : a), ''), ref = between(lastDay, now) > 75 ? now : lastDay, groups = new Map<string, Transaction[]>();
  for (const t of exp) { const k = payKey(t.description || ''); if (k.length > 1) groups.set(k, [...(groups.get(k) ?? []), t]); }
  const out: Payment[] = [], used = new Set<string>();
  const take = (p: Payment | null, list: Transaction[]) => { if (p) { out.push(p); for (const t of list) used.add(t.id); } };
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const varies = serviceOf(key)?.varies ?? false;
    const sets = varies ? [list] : clusters(list, 0.15);
    const found = sets.map((x) => ({ x, p: pattern(key, x, ref, now) })).filter((y) => y.p && plausible(y.p, y.x.length, list.length));
    // o mesmo nome com dois valores: cada um fica com a sua chave
    found.forEach(({ x, p }, n) => take(n === 0 ? p : { ...p!, key: `${key}#${p!.cents}` }, x));
  }
  // nome que muda todos os meses (referências bancárias) mas a mesma categoria e exatamente o mesmo valor
  const same = new Map<string, Transaction[]>();
  for (const t of exp) if (!used.has(t.id) && t.amountCents >= 300) { const k = `cat:${t.categoryId}:${t.amountCents}`; same.set(k, [...(same.get(k) ?? []), t]); }
  for (const [key, list] of same) { if (list.length < 3) continue; const p = pattern(key, list, ref, now); if (p && p.frequency !== 'weekly' && p.frequency !== 'biweekly' && plausible(p, list.length, list.length)) take(p, list); }
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
  const found = detectPayments(txs.filter((t) => !t.recurringId || !ids.has(t.recurringId)), today).filter((p) => !skip.has(p.key) && !keys.has(p.key.split('#')[0]) && !auto.has(p.key)
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
