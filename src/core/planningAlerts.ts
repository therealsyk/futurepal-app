import { isGoalPaused } from './goalPause';
// Alertas do Planeamento para o sino que já existe (centro de notificações da app).
//  • regras: o que merece aviso, a partir da mesma projeção do Planeamento (não há um segundo cálculo);
//  • identidade: cada aviso tem um id fixo por acontecimento/ocorrência → não se repete ao recalcular ou mudar de página;
//  • estado: lido / dispensado / adiado, guardado por conta (base de dados ativa) → não passa para outro utilizador;
//  • "resolvido": quando o acontecimento deixa de existir (pago, data passou, dados mudaram) o aviso desaparece sozinho.
// Só avisos dentro da app: não há entrega em segundo plano nem notificações do sistema (ver limitações no resumo).
import type { Account } from '../db/database';
import { currentDbName } from '../db/app-db';
import { addDaysISO, daysBetween, isoOf, lastDayOf, monthKey, project, summarize, variableExpenses, type PlanInput } from './planning';
import { accountBalanceCents, salariesUntil } from './accounts';
import { payoff, splitDesc } from './debtPlan';

// ───────────────────────── preferências (um só sítio)
export type AlertKind = 'lowBalance' | 'payment' | 'annual' | 'budget' | 'goal' | 'debt' | 'groups' | 'planning';
export const ALERT_KINDS: AlertKind[] = ['planning', 'lowBalance', 'payment', 'annual', 'budget', 'goal', 'debt', 'groups'];
export interface AlertPrefs {
  on: Record<AlertKind, boolean>;
  advanceDays: number; // pagamentos próximos: com quantos dias de antecedência
  lowBalanceCents: number; // avisar se o saldo previsto ficar abaixo disto (0 = só negativo)
  budgetTiers: number[]; // patamares dos limites, em %
  annualDays: number[]; // despesas anuais: antecedências (dias)
  savingTips: boolean; // sugerir quanto se poupava sem pagamentos recorrentes não essenciais (subscrições)
}
export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  on: { planning: true, lowBalance: true, payment: true, annual: true, budget: true, goal: true, debt: true, groups: true },
  advanceDays: 3, lowBalanceCents: 0, budgetTiers: [50, 80, 100], annualDays: [90, 60, 30], savingTips: true,
};
const PREFS_KEY = 'wallet.alerts';
export const NOTES_EVENT = 'wallet:notes';
export function loadAlertPrefs(): AlertPrefs {
  try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); return { ...DEFAULT_ALERT_PREFS, ...p, on: { ...DEFAULT_ALERT_PREFS.on, ...(p.on ?? {}) } }; } catch { return { ...DEFAULT_ALERT_PREFS }; }
}
export function saveAlertPrefs(p: AlertPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* sem storage */ }
  window.dispatchEvent(new Event(NOTES_EVENT));
}

// ───────────────────────── estado de cada aviso (por conta)
export interface NoteState { read: Record<string, string>; dismissed: Record<string, string>; snoozed: Record<string, string> }
const stateKey = () => `wallet.notes.${currentDbName()}`;
export function loadNoteState(): NoteState {
  try { const s = JSON.parse(localStorage.getItem(stateKey()) || '{}'); return { read: s.read ?? {}, dismissed: s.dismissed ?? {}, snoozed: s.snoozed ?? {} }; } catch { return { read: {}, dismissed: {}, snoozed: {} }; }
}
function saveNoteState(s: NoteState) {
  // limpeza: estados com mais de 400 dias já não servem
  const old = new Date(Date.now() - 400 * 864e5).toISOString();
  for (const k of ['read', 'dismissed'] as const) for (const [id, at] of Object.entries(s[k])) if (at < old) delete s[k][id];
  try { localStorage.setItem(stateKey(), JSON.stringify(s)); } catch { /* sem storage */ }
  window.dispatchEvent(new Event(NOTES_EVENT));
}
const now = () => new Date().toISOString();
export function markRead(ids: string[]) { const s = loadNoteState(); for (const id of ids) s.read[id] ??= now(); saveNoteState(s); }
export function dismissNote(id: string) { const s = loadNoteState(); s.dismissed[id] = now(); saveNoteState(s); }
export function snoozeNote(id: string, days = 1) { const s = loadNoteState(); s.snoozed[id] = addDaysISO(new Date().toLocaleDateString('sv-SE'), days); saveNoteState(s); }
/** Visível = não dispensado e não adiado (o adiamento acaba no dia indicado). */
export function visibleNote(id: string, s: NoteState, today: string) { return !s.dismissed[id] && !(s.snoozed[id] && s.snoozed[id] > today); }
/** Dispensar um aviso do Planeamento (momento) usa o mesmo estado: mesma identidade nas duas superfícies. */
export const isDismissed = (id: string) => !!loadNoteState().dismissed[id];

// ───────────────────────── regras
export interface PlanAlert {
  id: string; kind: AlertKind; priority: 1 | 2 | 3; // 1 = mais importante
  date: string; to: string;
  // dados para o texto (o texto é montado na interface, na língua da pessoa)
  p: { cents?: number; name?: string; days?: number; tier?: number; ratio?: number; forecast?: boolean; date?: string; months?: number };
}

/** Avisos a partir dos dados atuais. Pura (testável): recebe hoje, os dados e as preferências. */
/** Pagamento recorrente não essencial: subscrições, lazer, streaming (pela categoria). */
const OPTIONAL = new Set(['catSubscriptions', 'catStreaming', 'catFun', 'catGames', 'catApps', 'catLeisure', 'catMusic']);
export const isOptional = (r: { type: string; toAccountId?: string; categoryId: string }, catKey: (id: string) => string) => r.type === 'expense' && !r.toAccountId && OPTIONAL.has(catKey(r.categoryId));
const PER_YEAR: Record<string, number> = { daily: 365, weekly: 52, biweekly: 26, monthly: 12, bimonthly: 6, quarterly: 4, semiannual: 2, yearly: 1 };
export const yearlyCents = (r: { amountCents: number; frequency: string }) => r.amountCents * (PER_YEAR[r.frequency] ?? 12);

export function buildAlerts(inp: PlanInput, prefs: AlertPrefs, catName: (id: string) => string = () => '', catKey: (id: string) => string = () => ''): PlanAlert[] {
  const out: PlanAlert[] = [];
  const today = inp.today, [y, m] = today.split('-').map(Number);
  const in30 = addDaysISO(today, 30), maxAnnual = Math.max(0, ...prefs.annualDays);
  const proj = project(inp, today, addDaysISO(today, Math.max(30, maxAnnual)));
  const sum = summarize({ ...proj, end: in30, points: proj.points.filter((x) => x.date <= in30), events: proj.events.filter((e) => e.date <= in30) });
  const unsure = proj.partial.some((x) => x.kind === 'noIncome' || x.kind === 'noHistory');

  // saldo previsto baixo / negativo (30 dias). Com dados incompletos não se alarma.
  if (prefs.on.lowBalance && !unsure && sum.low && sum.low.cents < prefs.lowBalanceCents) {
    const first = proj.points.find((x) => x.date > today && x.date <= in30 && (x.projected ?? 0) < prefs.lowBalanceCents)!;
    // um aviso por mês em que acontece (pequenas oscilações não criam avisos novos)
    out.push({ id: `low:${monthKey(first.date)}`, kind: 'lowBalance', priority: 1, date: first.date, to: '/planeamento', p: { cents: sum.low.cents, date: first.date, forecast: true } });
  }
  // pagamentos próximos (recorrências, prestações, pontuais)
  if (prefs.on.payment) {
    const lim = addDaysISO(today, prefs.advanceDays);
    for (const e of proj.events) if (e.cents < 0 && e.date <= lim && ['recurring', 'oneoff', 'instalment', 'transfer'].includes(e.kind))
      { const r = e.sourceId ? inp.recurrings.find((x) => x.id === e.sourceId) : undefined;
        const save = prefs.savingTips && r && isOptional(r, catKey) ? yearlyCents(r) : 0; // ratio = poupança por ano (só subscrições)
        out.push({ id: `pay:${e.id}`, kind: 'payment', priority: 2, date: e.date, to: e.to, p: { cents: -e.cents, name: e.label, days: daysBetween(today, e.date), ...(save ? { ratio: save } : {}) } }); }
  }
  // despesas anuais/semestrais: só o patamar atual (90/60/30 dias) → um aviso por patamar e ocorrência
  if (prefs.on.annual) for (const r of inp.recurrings) {
    if (r.type !== 'expense' || r.toAccountId || !['yearly', 'semiannual'].includes(r.frequency)) continue;
    const d = daysBetween(today, r.nextDate);
    const tier = [...prefs.annualDays].sort((a, b) => a - b).find((t) => d <= t);
    if (d < 0 || tier === undefined || d <= prefs.advanceDays) continue; // muito perto: já é "pagamento próximo"
    out.push({ id: `annual:${r.id}:${r.nextDate}:${tier}`, kind: 'annual', priority: 2, date: r.nextDate, to: '/subscricoes', p: { cents: r.amountCents, name: r.description, days: d } });
  }
  // limites: patamar atingido (real) e previsão de passar o limite (estimativa) — distintos
  if (prefs.on.budget) {
    const ym = `${y}-${String(m).padStart(2, '0')}`, s = isoOf(y, m - 1, 1), e = lastDayOf(y, m - 1);
    const { rows } = variableExpenses(inp, proj.accounts);
    const elapsed = daysBetween(s, today) + 1, total = daysBetween(s, e) + 1;
    for (const b of inp.budgets) {
      if (b.year !== y || b.month !== m || b.limitCents <= 0) continue;
      const spent = inp.txs.filter((t) => t.type === 'expense' && t.categoryId === b.categoryId && t.date >= s && t.date <= today).reduce((a, t) => a + t.amountCents, 0);
      const ratio = spent / b.limitCents;
      const tier = [...prefs.budgetTiers].sort((a, b2) => b2 - a).find((t) => ratio * 100 >= t);
      if (tier !== undefined) out.push({ id: `budget:${b.categoryId}:${ym}:${tier}`, kind: 'budget', priority: tier >= 100 ? 1 : 3, date: today, to: '/orcamentos', p: { name: catName(b.categoryId), tier, ratio } });
      else if (elapsed >= 7) { // ritmo do mês (só as despesas variáveis desta categoria)
        const varSpent = rows.filter((t) => t.categoryId === b.categoryId && t.date >= s && t.date <= today).reduce((a, t) => a + t.amountCents, 0);
        const fc = spent + Math.round((varSpent / elapsed) * (total - elapsed));
        if (fc >= b.limitCents) out.push({ id: `budgetFc:${b.categoryId}:${ym}`, kind: 'budget', priority: 3, date: today, to: '/orcamentos', p: { name: catName(b.categoryId), forecast: true, ratio: fc / b.limitCents } });
      }
    }
  }
  // metas: prazo a aproximar-se ou concluída
  if (prefs.on.goal) for (const g of inp.goals.filter((x) => !isGoalPaused(x, today))) {
    if (g.currentCents >= g.targetCents && g.targetCents > 0) { out.push({ id: `goalDone:${g.id}`, kind: 'goal', priority: 3, date: today, to: '/metas', p: { name: g.name } }); continue; }
    if (!g.targetDate) continue;
    const d = daysBetween(today, g.targetDate.slice(0, 10));
    if (d >= 0 && d <= 30) out.push({ id: `goalDue:${g.id}:${g.targetDate.slice(0, 10)}`, kind: 'goal', priority: 2, date: g.targetDate.slice(0, 10), to: '/metas', p: { name: g.name, days: d, cents: g.targetCents - g.currentCents } });
  }
  // dívidas: última prestação prevista / concluída
  if (prefs.on.debt) {
    const txs = inp.txs.filter((t) => t.date <= today), trs = inp.transfers.filter((t) => t.date <= today), sal = salariesUntil(inp.salaries, y, m);
    for (const a of inp.accounts as Account[]) {
      if (a.type !== 'debt') continue;
      const plan = splitDesc(a.description).plan, left = Math.max(0, accountBalanceCents(a, txs, inp.accounts, sal, trs));
      if (left === 0 && (plan?.startCents ?? a.initialBalanceCents) > 0) { out.push({ id: `debtDone:${a.id}`, kind: 'debt', priority: 3, date: today, to: '/contas?tab=debt', p: { name: a.name } }); continue; }
      const po = plan && plan.monthlyCents > 0 ? payoff(left, plan.monthlyCents, plan.rate ?? 0) : null;
      if (po && po.months === 1) out.push({ id: `debtEnd:${a.id}:${monthKey(today)}`, kind: 'debt', priority: 3, date: today, to: '/contas?tab=debt', p: { name: a.name, cents: left } });
    }
  }
  // novo mês: o Planeamento passa a mostrar o mês seguinte (um aviso por mês)
  if (prefs.on.planning) {
    const nx = isoOf(y, m, 1);
    out.push({ id: `plan:${monthKey(today)}`, kind: 'planning', priority: 2, date: today, to: '/planeamento', p: { date: nx } });
  }
  // grupos partilhados: o que falta pagar (só com dados confirmados do servidor)
  if (prefs.on.groups && inp.groups && inp.groups.oweCents > 0)
    out.push({ id: `grpOwe:${monthKey(today)}`, kind: 'groups', priority: 3, date: today, to: '/grupos', p: { cents: inp.groups.oweCents } });

  // um aviso por id; mais importantes primeiro, depois os mais próximos
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))).sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date));
}
