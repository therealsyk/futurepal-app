// Planeamento: motor de projeção do saldo (determinístico, sem IA, sem tocar nos dados).
//
// Parte do saldo de HOJE das contas escolhidas e junta só o que ainda não aconteceu:
//   • rendimentos explicitamente previstos (salários já registados para meses futuros, rendimentos recorrentes,
//     transações com data futura);
//   • recorrências confirmadas (as sugestões automáticas não entram);
//   • pagamentos pontuais com data futura;
//   • prestações agendadas (transferências recorrentes para dívidas);
//   • despesas variáveis estimadas a partir do histórico (ou dos limites, se a pessoa escolher).
// Cada movimento entra uma vez e guarda a origem (para abrir a página certa). Mensal e anual usam este mesmo motor.
import type { Account, Budget, Goal, Recurring, RecurringFrequency, Salary, Transaction, Transfer } from '../db/database';
import { accountBalanceCents, defaultAccountId, salariesUntil } from './accounts';
import { advanceDate } from './finance';
import { payoff, splitDesc } from './debtPlan';
import { isSalaryTx } from './salaryTx';

// ───────────────────────── tipos
export type EstimateMode = 'history' | 'limits' | 'off';
export interface PlanOptions {
  accountIds: string[] | null; // null = todas as contas de gastos e poupança na moeda principal
  estimate: EstimateMode;
  reserveCents: number; // reserva mínima: baixa a margem, não o saldo
  goalReserve: boolean; // contar as contribuições planeadas para metas "à mão" como reserva
}
export const DEFAULT_PLAN_OPTIONS: PlanOptions = { accountIds: null, estimate: 'history', reserveCents: 0, goalReserve: true };

export type EventKind = 'salary' | 'income' | 'recurring' | 'oneoff' | 'instalment' | 'transfer' | 'estimate';
export interface PlanEvent {
  id: string; // único por ocorrência (origem + data)
  date: string;
  cents: number; // efeito no conjunto de contas escolhidas (+ entra, − sai)
  kind: EventKind;
  label: string;
  certainty: 'scheduled' | 'estimated';
  to: string; // página de origem
  sourceId?: string;
  frequency?: RecurringFrequency;
  overdue?: boolean; // recorrência que já devia ter acontecido e ainda não foi registada
}
export interface PlanInput {
  today: string; // AAAA-MM-DD (dia local)
  currency: string;
  accounts: Account[]; txs: Transaction[]; transfers: Transfer[]; salaries: Salary[]; recurrings: Recurring[]; budgets: Budget[]; goals: Goal[];
  options: PlanOptions;
  groups?: { oweCents: number; owedToMeCents: number } | null; // null = sem ligação (não se sabe)
}
export interface DayPoint { date: string; observed: number | null; scheduled: number | null; projected: number | null; inCents: number; outCents: number; events: PlanEvent[] }
export type PartialReason =
  | { kind: 'noIncome'; month: string } // sem salário/rendimento registado para um mês futuro em que antes havia
  | { kind: 'noHistory' } // histórico curto: sem estimativa de despesas variáveis
  | { kind: 'debtNoSchedule'; accountId: string; name: string; monthlyCents: number } // prestação planeada sem pagamento agendado
  | { kind: 'groupsUnknown' } // sem ligação: não se sabe o que falta pagar nos grupos partilhados
  | { kind: 'otherCurrency'; accountId: string; name: string; currency: string };
export interface EstimateInfo { mode: EstimateMode; dailyCents: number; months: number; days: number; ok: boolean; excludedDup: number; oneOffs?: Transaction[]; widened?: boolean }
export interface Projection {
  start: string; end: string; today: string;
  accounts: Account[]; // contas incluídas
  startBalance: number; // saldo no início da janela (observado se for hoje ou antes)
  todayBalance: number;
  points: DayPoint[]; // um por dia, de start a end
  events: PlanEvent[]; // futuros, dentro da janela
  partial: PartialReason[];
  estimate: EstimateInfo;
  reserves: { minimum: number; goals: number; goalList: Array<{ id: string; name: string; cents: number }> };
  groups: { oweCents: number; owedToMeCents: number } | null;
}

// ───────────────────────── datas (sempre AAAA-MM-DD, sem fusos)
const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (y: number, m0: number, d: number) => { const x = new Date(Date.UTC(y, m0, d)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
export const addDaysISO = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(y, m - 1, d + n); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
export const monthKey = (iso: string) => iso.slice(0, 7);
export const lastDayOf = (y: number, m0: number) => isoOf(y, m0 + 1, 0);

// ───────────────────────── contas e movimentos realizados
/** Contas que entram: gastos/poupança na moeda principal (as dívidas nunca são dinheiro próprio). */
export function pickAccounts(accounts: Account[], opts: PlanOptions, currency: string): { used: Account[]; other: Account[] } {
  const live = accounts.filter((a) => a.deletedAt === null && a.type !== 'debt');
  const chosen = opts.accountIds ? live.filter((a) => opts.accountIds!.includes(a.id)) : live;
  return { used: chosen.filter((a) => a.currency === currency), other: chosen.filter((a) => a.currency !== currency) };
}

/** Despesas criadas por transferências: o dinheiro já sai pela própria transferência. */
const fromTransferIds = (transfers: Transfer[]) => new Set(transfers.map((t) => t.transactionId).filter(Boolean) as string[]);
const movesMoney = (t: Transaction, fromTr: Set<string>) => t.deletedAt === null && !isSalaryTx(t) && !t.transferId && !t.id.startsWith('tr-') && !fromTr.has(t.id);

/** Movimentos já registados (até hoje) que mexem no conjunto de contas, por dia. Usado para o histórico do gráfico. */
function realizedByDay(inp: PlanInput, ids: Set<string>, def: string, from: string, today: string): Map<string, { in: number; out: number }> {
  const out = new Map<string, { in: number; out: number }>();
  const add = (d: string, c: number) => { if (d < from || d > today || !c) return; const x = out.get(d) ?? { in: 0, out: 0 }; if (c > 0) x.in += c; else x.out -= c; out.set(d, x); };
  const fromTr = fromTransferIds(inp.transfers);
  for (const t of inp.txs) if (movesMoney(t, fromTr) && ids.has(t.accountId ?? def)) add(t.date, t.type === 'income' ? t.amountCents : -t.amountCents);
  for (const tr of inp.transfers) {
    if (tr.deletedAt !== null) continue;
    add(tr.date, (ids.has(tr.toAccountId) ? tr.amountCents : 0) - (ids.has(tr.fromAccountId) ? tr.amountCents : 0));
  }
  if (ids.has(def)) for (const s of inp.salaries) if (s.deletedAt === null && s.amountCents > 0) add(`${s.year}-${pad(s.month)}-01`, s.amountCents);
  return out;
}

/** Saldo de hoje das contas escolhidas (só o que já aconteceu: transações com data futura ficam de fora). */
export function balanceToday(inp: PlanInput, used: Account[]): number {
  const today = inp.today, [y, m] = today.split('-').map(Number);
  const txs = inp.txs.filter((t) => t.date <= today), trs = inp.transfers.filter((t) => t.date <= today);
  const sal = salariesUntil(inp.salaries, y, m);
  return used.reduce((s, a) => s + accountBalanceCents(a, txs, inp.accounts, sal, trs), 0);
}

// ───────────────────────── eventos futuros (agendados)
const norm = (s: string) => s.trim().toLowerCase();

export function scheduledEvents(inp: PlanInput, used: Account[], until: string): PlanEvent[] {
  const ids = new Set(used.map((a) => a.id)), def = (defaultAccountId(inp.accounts) ?? ''), today = inp.today;
  const debtIds = new Set(inp.accounts.filter((a) => a.type === 'debt').map((a) => a.id));
  const ev: PlanEvent[] = [];
  // recorrências confirmadas (a app já regista as que venceram; as que ainda não foram registadas contam hoje)
  for (const r of inp.recurrings) {
    if (r.deletedAt !== null || r.currency !== inp.currency) continue;
    let d = r.nextDate; const anchor = Number(r.nextDate.slice(8, 10)), end = r.endDate && r.endDate < until ? r.endDate : until;
    for (let n = 0; d <= end && n < 1000; n++, d = advanceDate(d, r.frequency, anchor)) {
      const overdue = d <= today, date = overdue ? addDaysISO(today, 1) : d; // por registar: entra amanhã, não no saldo de hoje
      if (r.toAccountId) {
        const from = r.accountId ?? def, cents = (ids.has(r.toAccountId) ? r.amountCents : 0) - (ids.has(from) ? r.amountCents : 0);
        if (!cents) continue;
        const debt = debtIds.has(r.toAccountId);
        ev.push({ id: `rec:${r.id}:${d}`, date, cents, kind: debt ? 'instalment' : 'transfer', label: r.description, certainty: 'scheduled', to: debt ? `/contas?tab=debt` : '/subscricoes', sourceId: r.id, frequency: r.frequency, overdue });
      } else {
        if (!ids.has(r.accountId ?? def)) continue;
        ev.push({ id: `rec:${r.id}:${d}`, date, cents: r.type === 'income' ? r.amountCents : -r.amountCents, kind: r.type === 'income' ? 'income' : 'recurring', label: r.description, certainty: 'scheduled', to: '/subscricoes', sourceId: r.id, frequency: r.frequency, overdue });
      }
    }
  }
  // transações com data futura (pagamentos ou rendimentos pontuais já registados)
  const fromTr = fromTransferIds(inp.transfers);
  for (const t of inp.txs) {
    if (t.date <= today || t.date > until || !movesMoney(t, fromTr) || !ids.has(t.accountId ?? def) || t.currency !== inp.currency) continue;
    ev.push({ id: `tx:${t.id}`, date: t.date, cents: t.type === 'income' ? t.amountCents : -t.amountCents, kind: t.type === 'income' ? 'income' : 'oneoff', label: t.description, certainty: 'scheduled', to: `/transacoes?dia=${t.date}`, sourceId: t.id });
  }
  // transferências com data futura
  for (const tr of inp.transfers) {
    if (tr.deletedAt !== null || tr.date <= today || tr.date > until) continue;
    const cents = (ids.has(tr.toAccountId) ? tr.amountCents : 0) - (ids.has(tr.fromAccountId) ? tr.amountCents : 0);
    if (cents) ev.push({ id: `tr:${tr.id}`, date: tr.date, cents, kind: debtIds.has(tr.toAccountId) ? 'instalment' : 'transfer', label: tr.note, certainty: 'scheduled', to: '/transacoes', sourceId: tr.id });
  }
  // salários já registados para meses futuros (dia 1, como no resto da app)
  if (ids.has(def)) for (const s of inp.salaries) {
    const d = `${s.year}-${pad(s.month)}-01`;
    if (s.deletedAt !== null || !(s.amountCents > 0) || d <= today || d > until) continue;
    ev.push({ id: `sal:${s.id}`, date: d, cents: s.amountCents, kind: 'salary', label: '', certainty: 'scheduled', to: '/salarios', sourceId: s.id });
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date) || a.cents - b.cents);
}

// ───────────────────────── estimativa das despesas variáveis
/** Despesas que não são recorrentes nem transferências, nas contas escolhidas. As que coincidem com uma recorrência
 *  ativa (ex.: renda registada à mão antes de criar a recorrência) ficam de fora para não contarem duas vezes. */
export function variableExpenses(inp: PlanInput, used: Account[]): { rows: Transaction[]; excludedDup: number } {
  const ids = new Set(used.map((a) => a.id)), def = (defaultAccountId(inp.accounts) ?? ''), fromTr = fromTransferIds(inp.transfers);
  const recs = inp.recurrings.filter((r) => r.deletedAt === null && r.type === 'expense' && !r.toAccountId);
  let excludedDup = 0;
  const rows = inp.txs.filter((t) => {
    if (t.type !== 'expense' || t.recurringId || !movesMoney(t, fromTr) || !ids.has(t.accountId ?? def) || t.currency !== inp.currency) return false;
    const dup = recs.some((r) => (norm(r.description) && norm(r.description) === norm(t.description)) || (r.categoryId === t.categoryId && Math.abs(r.amountCents - t.amountCents) <= Math.max(100, r.amountCents * 0.05)));
    if (dup) excludedDup++;
    return !dup;
  });
  return { rows, excludedDup };
}

/** Gastos pontuais (não fazem parte do dia a dia normal): pelo menos 150 € e mais de 4× o valor habitual de uma
 *  compra dessa categoria (mediana), ou, numa categoria quase sem histórico, mais de 300 €. Ex.: IMT, imposto de selo,
 *  uma reparação grande. Ficam fora da média e aparecem à parte para a pessoa ver. */
export function oneOffExpenses(rows: Transaction[]): Transaction[] {
  const byCat = new Map<string, number[]>();
  for (const t of rows) (byCat.get(t.categoryId) ?? byCat.set(t.categoryId, []).get(t.categoryId)!).push(t.amountCents);
  const med = new Map([...byCat].map(([k, v]) => { const s = [...v].sort((a, b) => a - b); return [k, s[Math.floor((s.length - 1) / 2)]]; }));
  return rows.filter((t) => { const n = byCat.get(t.categoryId)!.length, md = med.get(t.categoryId)!; return t.amountCents >= 15000 && (n >= 3 ? t.amountCents > md * 4 : t.amountCents >= 30000 && n <= 2 && rows.length >= 6); });
}

/** Média por dia dos últimos meses completos (até 3). Com menos de 1 mês completo usa o mês atual se já tiver ≥ 14 dias. */
export function estimateDaily(inp: PlanInput, used: Account[]): EstimateInfo {
  const mode = inp.options.estimate;
  if (mode === 'off') return { mode, dailyCents: 0, months: 0, days: 0, ok: true, excludedDup: 0 };
  const { rows: all, excludedDup } = variableExpenses(inp, used);
  const oneOffs = oneOffExpenses(all), skip = new Set(oneOffs.map((t) => t.id));
  const rows = all.filter((t) => !skip.has(t.id));
  const [y, m] = inp.today.split('-').map(Number);
  // primeiro registo de qualquer tipo: um mês só conta se houver registos desde a primeira semana desse mês
  const first = inp.txs.reduce((a, t) => (t.deletedAt === null && t.date < a ? t.date : a), inp.today);
  // meses completos disponíveis (até 6), do mais recente para o mais antigo
  const per: Array<{ total: number; days: number }> = [];
  for (let k = 1; k <= 6; k++) {
    const s = isoOf(y, m - 1 - k, 1), e = lastDayOf(y, m - 1 - k);
    if (first > addDaysISO(s, 7)) break; // sem histórico desde o início deste mês
    per.push({ total: rows.filter((t) => t.date >= s && t.date <= e).reduce((a, t) => a + t.amountCents, 0), days: daysBetween(s, e) + 1 });
  }
  // normalmente 3 meses; alarga para 6 quando os últimos 3 tiveram gastos fora do normal (pontuais grandes, ou
  // muito acima dos 3 anteriores): assim um mês com IMT/obras não faz parecer que o dia a dia é sempre assim
  const s3 = isoOf(y, m - 4, 1), avg = (l: typeof per) => l.reduce((a, x) => a + x.total, 0) / Math.max(1, l.reduce((a, x) => a + x.days, 0));
  const unusual = oneOffs.some((t) => t.date >= s3) || (per.length >= 6 && avg(per.slice(0, 3)) > avg(per.slice(3, 6)) * 1.25);
  const use = per.slice(0, unusual && per.length > 3 ? 6 : 3);
  const total0 = use.reduce((a, x) => a + x.total, 0), days0 = use.reduce((a, x) => a + x.days, 0);
  let total = total0, days = days0, months = use.length;
  if (!months) { // só o mês atual
    const s = isoOf(y, m - 1, 1), elapsed = daysBetween(s, inp.today) + 1;
    if (elapsed < 14 || first > addDaysISO(s, 7)) return { mode, dailyCents: 0, months: 0, days: 0, ok: false, excludedDup };
    total = rows.filter((t) => t.date >= s && t.date <= inp.today).reduce((a, t) => a + t.amountCents, 0); days = elapsed;
  }
  return { mode, dailyCents: days ? Math.round(total / days) : 0, months, days, ok: true, excludedDup, oneOffs, widened: months > 3 };
}

/** Estimativa de um dia futuro. Modo "limites": nas categorias com limite usa o que falta do limite (espalhado
 *  pelos dias que faltam do mês); nas restantes usa o histórico dessas categorias. */
function estimateFor(date: string, inp: PlanInput, used: Account[], est: EstimateInfo, cache: Map<string, number>): number {
  if (!est.ok || est.mode === 'off') return 0;
  if (est.mode === 'history') return est.dailyCents;
  const mk = monthKey(date);
  if (cache.has(mk)) return cache.get(mk)!;
  const [y, m] = mk.split('-').map(Number);
  const bud = inp.budgets.filter((b) => b.deletedAt === null && b.year === y && b.month === m);
  if (!bud.length) { cache.set(mk, est.dailyCents); return est.dailyCents; }
  const s = isoOf(y, m - 1, 1), e = lastDayOf(y, m - 1), from = inp.today >= s ? addDaysISO(inp.today, 1) : s;
  const left = Math.max(1, daysBetween(from, e) + 1);
  const { rows } = variableExpenses(inp, used);
  const cats = new Set(bud.map((b) => b.categoryId));
  let perDay = 0;
  for (const b of bud) {
    const spent = rows.filter((t) => t.categoryId === b.categoryId && t.date >= s && t.date <= inp.today).reduce((a, t) => a + t.amountCents, 0);
    perDay += Math.max(0, b.limitCents - spent) / left;
  }
  // categorias sem limite: parte do histórico que não é dessas categorias
  const hist = rows.filter((t) => !cats.has(t.categoryId));
  const hs = isoOf(Number(inp.today.slice(0, 4)), Number(inp.today.slice(5, 7)) - 1 - Math.max(1, est.months), 1);
  const he = est.months ? lastDayOf(Number(inp.today.slice(0, 4)), Number(inp.today.slice(5, 7)) - 2) : inp.today;
  const hd = Math.max(1, daysBetween(hs, he) + 1);
  perDay += hist.filter((t) => t.date >= hs && t.date <= he).reduce((a, t) => a + t.amountCents, 0) / hd;
  const v = Math.round(perDay);
  cache.set(mk, v);
  return v;
}

// ───────────────────────── motor
export function project(inp: PlanInput, start: string, end: string): Projection {
  const { used, other } = pickAccounts(inp.accounts, inp.options, inp.currency);
  const ids = new Set(used.map((a) => a.id)), def = (defaultAccountId(inp.accounts) ?? ''), today = inp.today;
  const partial: PartialReason[] = other.map((a) => ({ kind: 'otherCurrency' as const, accountId: a.id, name: a.name, currency: a.currency }));
  const todayBal = balanceToday(inp, used);
  const horizon = end > today ? end : today;
  const sched = scheduledEvents(inp, used, horizon);
  const est = estimateDaily(inp, used);
  if (!est.ok) partial.push({ kind: 'noHistory' });

  // rendimentos: mês futuro sem salário registado, quando os meses anteriores tinham
  if (ids.has(def)) {
    const had = inp.salaries.filter((s) => s.deletedAt === null && s.amountCents > 0);
    const hasPast = had.some((s) => `${s.year}-${pad(s.month)}-01` <= today);
    const incomeMonths = new Set(sched.filter((e) => e.kind === 'salary' || (e.kind === 'income' && e.frequency)).map((e) => monthKey(e.date)));
    if (hasPast) for (let d = isoOf(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1); d <= end; d = isoOf(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)) {
      if (!incomeMonths.has(monthKey(d))) { partial.push({ kind: 'noIncome', month: monthKey(d) }); break; }
    }
  }
  // dívidas com prestação planeada mas sem pagamento agendado
  for (const a of inp.accounts) {
    if (a.deletedAt !== null || a.type !== 'debt') continue;
    const p = splitDesc(a.description).plan;
    const scheduled = inp.recurrings.some((r) => r.deletedAt === null && r.toAccountId === a.id && (!r.endDate || r.endDate >= today));
    if (p && p.monthlyCents > 0 && !scheduled) partial.push({ kind: 'debtNoSchedule', accountId: a.id, name: a.name, monthlyCents: p.monthlyCents });
  }
  if (inp.groups === null) partial.push({ kind: 'groupsUnknown' });

  // histórico observado: andar para trás a partir do saldo de hoje
  const real = realizedByDay(inp, ids, def, start < today ? start : today, today);
  const obs = new Map<string, number>();
  if (start <= today) {
    let b = todayBal;
    for (let d = today; d >= start; d = addDaysISO(d, -1)) { obs.set(d, b); const r = real.get(d); if (r) b -= r.in - r.out; }
  }
  // futuro: agendado (só eventos) e projetado (eventos + estimativa)
  const byDay = new Map<string, PlanEvent[]>();
  for (const e of sched) (byDay.get(e.date) ?? byDay.set(e.date, []).get(e.date)!).push(e);
  const cache = new Map<string, number>();
  const points: DayPoint[] = [];
  let sch = todayBal, pro = todayBal;
  const events: PlanEvent[] = [];
  // dias entre hoje e o início da janela (janela no futuro): avançar sem guardar pontos
  for (let d = addDaysISO(today, 1); d < start; d = addDaysISO(d, 1)) {
    const evs = byDay.get(d) ?? []; const net = evs.reduce((a, e) => a + e.cents, 0);
    sch += net; pro += net - estimateFor(d, inp, used, est, cache);
  }
  for (let d = start; d <= end; d = addDaysISO(d, 1)) {
    if (d <= today) {
      const r = real.get(d), o = obs.get(d) ?? null;
      points.push({ date: d, observed: o, scheduled: d === today ? o : null, projected: d === today ? o : null, inCents: r?.in ?? 0, outCents: r?.out ?? 0, events: [] });
      continue;
    }
    const evs = byDay.get(d) ?? [];
    const e = estimateFor(d, inp, used, est, cache);
    const net = evs.reduce((a, x) => a + x.cents, 0);
    sch += net; pro += net - e;
    const dayEv = e > 0 ? [...evs, { id: `est:${d}`, date: d, cents: -e, kind: 'estimate' as const, label: '', certainty: 'estimated' as const, to: '/transacoes' }] : evs;
    events.push(...evs);
    points.push({ date: d, observed: null, scheduled: sch, projected: pro, inCents: evs.filter((x) => x.cents > 0).reduce((a, x) => a + x.cents, 0), outCents: -evs.filter((x) => x.cents < 0).reduce((a, x) => a + x.cents, 0) + e, events: dayEv });
  }
  // reservas: mínima + contribuições planeadas para metas "à mão" (o dinheiro fica na conta, só não está livre)
  const months = Math.max(1, (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1);
  const futureMonths = end <= today ? 0 : Math.max(1, months - (start <= today ? (Number(today.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(start.slice(5, 7)) : 0));
  const goalList = inp.options.goalReserve ? inp.goals.filter((g) => g.deletedAt === null && !g.accountIds?.length && (splitDesc(g.notes).plan?.monthlyCents ?? 0) > 0 && g.currentCents < g.targetCents)
    .map((g) => ({ id: g.id, name: g.name, cents: Math.min(g.targetCents - g.currentCents, (splitDesc(g.notes).plan!.monthlyCents) * futureMonths) })) : [];
  const startBalance = start <= today ? (obs.get(start) ?? todayBal) : (() => { // saldo projetado na véspera da janela
    let b = todayBal; for (const e of sched) if (e.date < start) b += e.cents;
    for (let d = addDaysISO(today, 1); d < start; d = addDaysISO(d, 1)) b -= estimateFor(d, inp, used, est, cache);
    return b; })();
  return {
    start, end, today, accounts: used, startBalance, todayBalance: todayBal, points, events, partial, estimate: est,
    reserves: { minimum: Math.max(0, inp.options.reserveCents), goals: goalList.reduce((a, g) => a + g.cents, 0), goalList },
    groups: inp.groups ?? null,
  };
}

// ───────────────────────── resumo (cards, composição, momentos)
export interface PlanSummary {
  from: string; // primeiro dia projetado da janela (amanhã, ou o início da janela no futuro)
  base: number; // saldo de partida
  baseDate: string;
  income: number; recurring: number; oneoff: number; instalments: number; transfers: number; estimated: number; // composição (sinais: + entra, − sai)
  endScheduled: number; endProjected: number; // saldo final sem e com estimativa
  commitments: number; // saídas futuras conhecidas (positivo)
  afterCommitments: number; // base − compromissos (sem entradas nem outras despesas)
  low: { date: string; cents: number } | null; // menor saldo previsto (com estimativa)
  firstNegative: string | null;
  nextIncome: string | null;
  shortfallBeforeIncome: { date: string; cents: number } | null; // falta de saldo antes do próximo rendimento
  margin: number; // menor saldo previsto − reservas − por pagar em grupos
  finished: boolean; // janela toda no passado
}
export function summarize(p: Projection): PlanSummary {
  const fut = p.points.filter((x) => x.date > p.today);
  const finished = !fut.length;
  const from = fut[0]?.date ?? p.end;
  const base = p.start > p.today ? p.startBalance : p.todayBalance;
  const baseDate = p.start > p.today ? addDaysISO(p.start, -1) : p.today;
  const sum = (k: EventKind[]) => p.events.filter((e) => k.includes(e.kind)).reduce((a, e) => a + e.cents, 0);
  const estimated = -fut.reduce((a, x) => a + x.events.filter((e) => e.kind === 'estimate').reduce((b, e) => b - e.cents, 0), 0);
  const commitments = -p.events.filter((e) => e.cents < 0).reduce((a, e) => a + e.cents, 0);
  const last = p.points[p.points.length - 1];
  const endScheduled = finished ? last.observed ?? base : last.scheduled ?? base;
  const endProjected = finished ? last.observed ?? base : last.projected ?? base;
  let low: PlanSummary['low'] = null, firstNegative: string | null = null;
  for (const x of fut) { const v = x.projected!; if (!low || v < low.cents) low = { date: x.date, cents: v }; if (v < 0 && !firstNegative) firstNegative = x.date; }
  const nextIncome = p.events.find((e) => e.cents > 0 && (e.kind === 'salary' || e.kind === 'income'))?.date ?? null;
  let shortfall: PlanSummary['shortfallBeforeIncome'] = null;
  for (const x of fut) { if (nextIncome && x.date >= nextIncome) break; if (x.projected! < 0 && (!shortfall || x.projected! < shortfall.cents)) shortfall = { date: x.date, cents: x.projected! }; }
  const lowest = finished ? endProjected : Math.min(base, low?.cents ?? base);
  const margin = lowest - p.reserves.minimum - p.reserves.goals - (p.groups?.oweCents ?? 0);
  return {
    from, base, baseDate, income: sum(['salary', 'income']), recurring: sum(['recurring']), oneoff: sum(['oneoff']), instalments: sum(['instalment']), transfers: sum(['transfer']), estimated,
    endScheduled, endProjected, commitments, afterCommitments: base - commitments, low, firstNegative, nextIncome, shortfallBeforeIncome: shortfall, margin, finished,
  };
}

/** Fecho de cada mês (para a vista anual): último saldo do mês e o menor saldo dentro do mês. */
export function monthlyClose(p: Projection): Array<{ month: string; close: number; low: number; observed: boolean; partly: boolean; inCents: number; outCents: number }> {
  const m = new Map<string, { close: number; low: number; observed: boolean; partly: boolean; inCents: number; outCents: number }>();
  for (const x of p.points) {
    const v = x.observed ?? x.projected ?? 0, k = monthKey(x.date), cur = m.get(k);
    const obs = x.observed !== null && x.date !== p.today ? true : x.date <= p.today;
    if (!cur) m.set(k, { close: v, low: v, observed: obs, partly: !obs, inCents: x.inCents, outCents: x.outCents });
    else { cur.close = v; cur.low = Math.min(cur.low, v); cur.observed = cur.observed && obs; cur.partly = cur.partly || !obs; cur.inCents += x.inCents; cur.outCents += x.outCents; }
  }
  return [...m.entries()].map(([month, v]) => ({ month, ...v }));
}

// ───────────────────────── momentos a ter em conta
export type MomentKind = 'low' | 'negative' | 'bigPayment' | 'annual' | 'debtEnd' | 'goalLate' | 'extraMargin';
export interface Moment { id: string; kind: MomentKind; date: string; cents: number; label?: string; to: string; extra?: number; months?: number }
export function moments(p: Projection, s: PlanSummary, inp: PlanInput, balOf: (a: Account) => number): Moment[] {
  if (s.finished) return [];
  const out: Moment[] = [];
  if (s.firstNegative) {
    const low = s.low!;
    out.push({ id: `neg:${monthKey(s.firstNegative)}`, kind: 'negative', date: s.firstNegative, cents: low.cents, to: '/planeamento' });
  } else if (s.low && s.low.cents < s.base) out.push({ id: `low:${s.low.date}`, kind: 'low', date: s.low.date, cents: s.low.cents, to: '/planeamento' });
  // maior pagamento previsto (só se for relevante: pelo menos 15% do saldo de partida ou 250 €)
  const outs = p.events.filter((e) => e.cents < 0);
  const big = outs.reduce<PlanEvent | null>((a, e) => (!a || e.cents < a.cents ? e : a), null);
  if (big && -big.cents >= Math.max(25000, Math.abs(s.base) * 0.15)) out.push({ id: `big:${big.id}`, kind: 'bigPayment', date: big.date, cents: big.cents, label: big.label, to: big.to });
  // despesas anuais/semestrais nos próximos 90 dias (mesmo que fora da janela)
  const in90 = addDaysISO(p.today, 90);
  for (const r of inp.recurrings) {
    if (r.deletedAt !== null || r.type !== 'expense' || r.toAccountId || !['yearly', 'semiannual'].includes(r.frequency) || r.nextDate > in90 || r.nextDate < p.today) continue;
    if (out.some((m) => m.id === `big:rec:${r.id}:${r.nextDate}`)) continue;
    out.push({ id: `annual:${r.id}:${r.nextDate}`, kind: 'annual', date: r.nextDate, cents: -r.amountCents, label: r.description, to: '/subscricoes', extra: Math.round(r.amountCents / (r.frequency === 'yearly' ? 12 : 6)) });
  }
  // fim de dívida (usa o mesmo cálculo de juros/prestação da app)
  for (const a of inp.accounts) {
    if (a.deletedAt !== null || a.type !== 'debt') continue;
    const plan = splitDesc(a.description).plan, left = Math.max(0, balOf(a));
    if (!plan || plan.monthlyCents <= 0 || left <= 0) continue;
    const po = payoff(left, plan.monthlyCents, plan.rate ?? 0);
    if (!po) continue;
    const endDate = isoOf(Number(p.today.slice(0, 4)), Number(p.today.slice(5, 7)) - 1 + po.months, 1);
    if (endDate <= p.end || po.months <= 3) out.push({ id: `debt:${a.id}:${monthKey(endDate)}`, kind: 'debtEnd', date: endDate, cents: left, label: a.name, to: '/contas?tab=debt', months: po.months });
  }
  // metas com data: ao ritmo planeado não chegam a tempo
  for (const g of inp.goals) {
    if (g.deletedAt !== null || !g.targetDate || g.accountIds?.length || g.currentCents >= g.targetCents) continue;
    const per = splitDesc(g.notes).plan?.monthlyCents ?? 0;
    const monthsLeft = Math.max(0, (Number(g.targetDate.slice(0, 4)) - Number(p.today.slice(0, 4))) * 12 + Number(g.targetDate.slice(5, 7)) - Number(p.today.slice(5, 7)));
    const need = g.targetCents - g.currentCents;
    if (per > 0 && per * monthsLeft < need) out.push({ id: `goal:${g.id}:${g.targetDate}`, kind: 'goalLate', date: g.targetDate.slice(0, 10), cents: need - per * monthsLeft, label: g.name, to: '/metas', months: Math.ceil(need / per) });
  }
  // margem adicional estimada (informação, não recomendação)
  if (!s.firstNegative && s.margin > Math.max(10000, s.commitments * 0.5) && !p.partial.some((x) => x.kind === 'noIncome' || x.kind === 'noHistory')) out.push({ id: `extra:${monthKey(p.end)}`, kind: 'extraMargin', date: p.end, cents: s.margin, to: '/metas' });
  const rank: Record<MomentKind, number> = { negative: 0, low: 1, bigPayment: 2, annual: 3, debtEnd: 4, goalLate: 5, extraMargin: 6 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.date.localeCompare(b.date));
}

// ───────────────────────── simulações (cópia dos dados: nada real é alterado)
export type SimChange =
  | { kind: 'oneoff'; cents: number; date: string; income: boolean }
  | { kind: 'debtExtra'; accountId: string; cents: number; date: string }
  | { kind: 'goalMonthly'; goalId: string; monthlyCents: number }
  | { kind: 'dropRecurring'; recurringId: string };
export function simulate(inp: PlanInput, change: SimChange): PlanInput {
  const SIM = 'sim-';
  const stamp = { createdAt: '', updatedAt: '', deletedAt: null };
  const def = (defaultAccountId(inp.accounts) ?? '');
  switch (change.kind) {
    case 'oneoff': return { ...inp, txs: [...inp.txs, { id: SIM + 'tx', date: change.date <= inp.today ? addDaysISO(inp.today, 1) : change.date, type: change.income ? 'income' : 'expense', categoryId: '', description: '', amountCents: change.cents, currency: inp.currency, accountId: def, ...stamp }] };
    case 'debtExtra': return { ...inp, transfers: [...inp.transfers, { id: SIM + 'tr', fromAccountId: def, toAccountId: change.accountId, amountCents: change.cents, date: change.date <= inp.today ? addDaysISO(inp.today, 1) : change.date, note: '', categoryId: null, transactionId: null, ...stamp } as Transfer] };
    case 'goalMonthly': return { ...inp, goals: inp.goals.map((g) => (g.id === change.goalId ? { ...g, notes: setGoalMonthly(g.notes, change.monthlyCents) } : g)) };
    case 'dropRecurring': return { ...inp, recurrings: inp.recurrings.filter((r) => r.id !== change.recurringId) };
  }
}
function setGoalMonthly(notes: string | undefined, monthly: number): string {
  const d = splitDesc(notes);
  const SEP = '⁣plan:';
  return `${d.text}${SEP}${monthly}:${d.plan?.startCents ?? 0}:${d.plan?.rate ?? ''}:${d.plan?.goalId ?? ''}`;
}
