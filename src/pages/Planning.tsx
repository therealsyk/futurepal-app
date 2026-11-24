// Planeamento do próximo mês: com o que costumas ganhar e gastar, as recorrências, as dívidas, as poupanças e as
// metas, diz se o mês está em ordem, o que está a pesar e o que podes fazer. Tem também as compras simuladas
// (ex.: "posso comprar um PC?"), que ficam guardadas até as adicionares ou apagares. Não repete listas de outras
// páginas: para ver ou mudar uma recorrência, meta, dívida ou limite, os links levam à página de origem.
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db, currentDbName } from '../db/app-db';
import type { Category } from '../db/database';
import { loadSettings } from '../core/settings';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { addTransaction } from '../core/finance';
import { accountBalanceCents, salariesUntil } from '../core/accounts';
import { splitDesc } from '../core/debtPlan';
import { estimateDaily, isoOf, lastDayOf, project, variableExpenses, type PlanInput } from '../core/planning';
import { loadPlanInput } from '../core/planningData';
import { isOptional, loadAlertPrefs, NOTES_EVENT, yearlyCents } from '../core/planningAlerts';
import { isGoalPaused } from '../core/goalPause';
import { isSalaryTx } from '../core/salaryTx';
import { useTxSaved } from '../ui/TxForm';
import { appConfirm } from '../ui/confirm';
import { CatIcon, catLabel, Ic, ICON, PickMenu } from '../ui/fx';
import { CountMoney } from '../ui/CountMoney';
import { CountText } from '../ui/CountText';
import { AccountRow, AmountField, CategoryRow, DateRow, SwitchRow, TextRow } from '../ui/formFields';
import { L } from '../i18n/phrases';
import { BottomSheet } from './SimplePages';
import { useMissing } from '../ui/missing';
import { markPeriodChange } from '../ui/rollGate';
import { PC_MOBILE } from '../core/uiMode';

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const MODE_KEY = 'wallet.planning.income';
type Tone = 'ok' | 'meh' | 'tight';

// ───────────────────────── compras simuladas (só neste aparelho, por conta)
export interface SimBuy { id: string; name: string; cents: number; categoryId: string; accountId: string; date: string; inst: boolean; months: number; groupId: string; createdAt: string }
const simKey = () => `wallet.sims.${currentDbName()}`;
const loadSims = (): SimBuy[] => { try { return JSON.parse(localStorage.getItem(simKey()) || '[]'); } catch { return []; } };
const saveSims = (l: SimBuy[]) => { try { localStorage.setItem(simKey(), JSON.stringify(l)); } catch { /* sem storage */ } };
const perMonthOf = (s: Pick<SimBuy, 'cents' | 'inst' | 'months'>) => (s.inst ? Math.ceil(s.cents / Math.max(2, s.months)) : s.cents);
/** Verde: cabe com folga; amarelo: à justa (gasta mais de metade do que sobra); vermelho: não cabe. */
const fitOf = (perMonth: number, free: number): Tone => (perMonth <= free * 0.5 ? 'ok' : perMonth <= free ? 'meh' : 'tight');

/** Cor da percentagem: despesas até 30% do rendimento = verde, até 50% = amarelo, mais = vermelho;
 *  poupar é bom (verde, amarelo se for pouco); sobrar é verde e faltar é vermelho. */
const pctTone = (k: string, p: number, left: number) => (k === 'left' ? (left < 0 ? 'bad' : 'good') : k === 'save' ? (p >= 0.1 ? 'good' : 'mid') : p <= 0.3 ? 'good' : p <= 0.5 ? 'mid' : 'bad');

const IC = {
  inc: 'M12 19V5M5 12l7-7 7 7', fixed: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', free: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z',
  weight: 'M12 3v3M5 21h14l-2-12H7zM9 6h6', bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z', bag: 'M6 7h12l-1 13H7zM9 7a3 3 0 0 1 6 0',
};

export function PlanningPage() {
  const { t } = useTranslation();
  const s = loadSettings(), lang = s.language, money = (c: number) => formatMoney(c, s.currency, lang);
  const [extras, setExtras] = useState(() => { try { return localStorage.getItem(MODE_KEY) !== 'salary'; } catch { return true; } });
  const [inp, setInp] = useState<PlanInput | null>(null), [cats, setCats] = useState<Category[]>([]), [tick, setTick] = useState(0);
  const [sims, setSims] = useState<SimBuy[]>(loadSims), [open, setOpen] = useState<SimBuy | 'new' | null>(null);
  const [openPart, setOpenPart] = useState<string | null>(null); // linha da legenda aberta
  const [tab, setTab] = useState<'w' | 's'>('w'); // separador no telemóvel
  const [cut, setCut] = useState<number | null>(null); // janela "onde podes cortar" (10% ou 25% do dia a dia)
  useTxSaved(() => setTick((n) => n + 1));
  useEffect(() => { const on = () => setTick((n) => n + 1); window.addEventListener(NOTES_EVENT, on); return () => window.removeEventListener(NOTES_EVENT, on); }, []);
  useEffect(() => { (async () => { setInp(await loadPlanInput(db, undefined, false)); setCats(await db.categories.toArray()); })().catch(() => {}); }, [tick]);
  const tips = loadAlertPrefs().savingTips;
  const setInc = (v: boolean) => { markPeriodChange(); setExtras(v); try { localStorage.setItem(MODE_KEY, v ? 'all' : 'salary'); } catch { /* sem storage */ } };
  const catName = (id: string) => { const c = cats.find((x) => x.id === id); return c ? catLabel(t, c) : ''; };

  const r = useMemo(() => {
    if (!inp) return null;
    const ty = Number(inp.today.slice(0, 4)), tm = Number(inp.today.slice(5, 7)) - 1;
    const ny = new Date(ty, tm + 1, 1).getFullYear(), nm = new Date(ty, tm + 1, 1).getMonth(); // o mês que vem
    const start = isoOf(ny, nm, 1), end = lastDayOf(ny, nm), days = Number(end.slice(8, 10));
    // rendimento: média dos últimos 3 meses completos
    const months = [1, 2, 3].map((k) => isoOf(ty, tm - k, 1).slice(0, 7));
    const sal = months.map((mk) => inp.salaries.filter((x) => `${x.year}-${String(x.month).padStart(2, '0')}` === mk).reduce((a, x) => a + x.amountCents, 0));
    const ext = months.map((mk) => inp.txs.filter((x) => x.type === 'income' && !isSalaryTx(x) && !x.transferId && x.date.startsWith(mk)).reduce((a, x) => a + x.amountCents, 0));
    const used = months.map((_, i) => sal[i] + ext[i] > 0).filter(Boolean).length || 1;
    const income = Math.round((sal.reduce((a, b) => a + b, 0) + (extras ? ext.reduce((a, b) => a + b, 0) : 0)) / used);
    // compromissos do mês que vem (do mesmo motor: cada coisa uma vez)
    const p = project(inp, start, end);
    const fixed = -p.events.filter((e) => e.kind === 'recurring' || e.kind === 'oneoff').reduce((a, e) => a + e.cents, 0);
    const debtSched = -p.events.filter((e) => e.kind === 'instalment').reduce((a, e) => a + e.cents, 0);
    const debtPlan = p.partial.reduce((a, x) => a + (x.kind === 'debtNoSchedule' ? x.monthlyCents : 0), 0);
    const debts = debtSched + debtPlan;
    // poupanças planeadas (contas de poupança com valor por mês) e metas "à mão" com data ou valor por mês
    const savPlan = inp.accounts.filter((a) => a.type === 'savings').reduce((a, x) => a + (splitDesc(x.description).plan?.monthlyCents ?? 0), 0);
    const savTop = inp.accounts.filter((a) => a.type === 'savings' && (splitDesc(a.description).plan?.monthlyCents ?? 0) > 0).sort((a, b) => (splitDesc(b.description).plan?.monthlyCents ?? 0) - (splitDesc(a.description).plan?.monthlyCents ?? 0))[0];
    const savTo = (cents: number) => (savTop ? `/contas?tab=savings&editar=${savTop.id}&mensal=${cents}` : '/contas?tab=savings');
    const savTopM = savTop ? splitDesc(savTop.description).plan?.monthlyCents ?? 0 : 0;
    const goals = inp.goals.filter((g) => !isGoalPaused(g, start) && !g.accountIds?.length && g.currentCents < g.targetCents && (g.targetDate || (splitDesc(g.notes).plan?.monthlyCents ?? 0) > 0)).map((g) => {
      const plan = splitDesc(g.notes).plan?.monthlyCents ?? 0;
      const ml = g.targetDate ? Math.max(1, (Number(g.targetDate.slice(0, 4)) - ty) * 12 + Number(g.targetDate.slice(5, 7)) - 1 - tm) : 0;
      return { id: g.id, name: g.name, need: Math.max(plan, ml ? Math.ceil((g.targetCents - g.currentCents) / ml) : 0), left: g.targetCents - g.currentCents, ratio: g.targetCents > 0 ? g.currentCents / g.targetCents : 0, until: g.targetDate ?? null, later: ml ? isoOf(ty, tm + ml * 2, 1).slice(0, 7) : null };
    });
    const goalNeed = goals.reduce((a, g) => a + g.need, 0);
    // dia a dia (média) e por categoria (para saber o que pesa)
    const est = estimateDaily({ ...inp, options: { ...inp.options, estimate: 'history' } }, p.accounts);
    const daily = est.ok ? est.dailyCents * days : 0;
    const hm = Math.max(1, est.months), hs = isoOf(ty, tm - hm, 1), he = isoOf(ty, tm, 1);
    const byCat = new Map<string, number>();
    const skipOne = new Set((est.oneOffs ?? []).map((x) => x.id));
    const byDesc = new Map<string, { cat: string; name: string; cents: number; n: number }>();
    for (const x of variableExpenses(inp, p.accounts).rows) if (x.date >= hs && x.date < he && !skipOne.has(x.id)) {
      byCat.set(x.categoryId, (byCat.get(x.categoryId) ?? 0) + x.amountCents);
      const nm = (x.description || '').trim(), k = x.categoryId + '|' + nm.toLowerCase(), o = byDesc.get(k) ?? { cat: x.categoryId, name: nm, cents: 0, n: 0 };
      o.cents += x.amountCents; o.n++; byDesc.set(k, o);
    }
    const catsAvg = [...byCat.entries()].map(([id, v]) => ({ id, avg: Math.round(v / hm) })).sort((a, b) => b.avg - a.avg);
    const spend = fixed + debts + daily, saveTarget = savPlan + goalNeed;
    const left = income - spend - saveTarget; // livre depois de cumprir tudo
    const tone: Tone = income <= 0 || left < 0 ? 'tight' : left < income * 0.1 ? 'meh' : 'ok';
    // o que pesa mais (mostrado quando não está tudo bem)
    const key = (id: string) => cats.find((c) => c.id === id)?.nameKey ?? '';
    const recs = inp.recurrings.filter((x) => x.type === 'expense' && !x.toAccountId).map((x) => ({ x, m: Math.round(yearlyCents(x) / 12) })).sort((a, b) => b.m - a.m);
    const weights = [
      ...catsAvg.slice(0, 2).map((c) => ({ id: 'c' + c.id, label: catName(c.id) || L('Outras despesas'), sub: fill(L('Em média, o que gastas por mês nesta categoria (últimos {n} meses, sem gastos pontuais)'), { n: String(Math.max(1, est.months)) }), cents: c.avg, catId: c.id, to: '/orcamentos' })),
      ...(recs[0] ? [{ id: 'r' + recs[0].x.id, label: recs[0].x.description, sub: L('O teu pagamento fixo mais caro (repete-se todos os meses)'), cents: recs[0].m, catId: recs[0].x.categoryId, to: '/subscricoes' }] : []),
      ...(debts > 0 ? [{ id: 'debt', label: L('Dívidas'), sub: L('Prestações dos teus empréstimos por mês'), cents: debts, catId: '', to: '/contas?tab=debt' }] : []),
      ...(goalNeed > 0 ? [{ id: 'goals', label: L('Metas'), sub: L('O que tens de juntar por mês para as metas chegarem a tempo'), cents: goalNeed, catId: '', to: '/metas' }] : []),
    ].sort((a, b) => b.cents - a.cents).slice(0, 3);
    // sugestões concretas (só as que fazem sentido para estes dados)
    const gap = Math.max(0, -left);
    // sugestões por nível: simples (quase não se nota), moderadas (algum esforço) e fortes (só se as outras não chegarem).
    // Cada uma só aparece se houver dados que a justifiquem; nada de cortar renda, contas fixas ou dívidas.
    type Sugg = { id: string; text: string; save: number; to: string; icon: string; cut?: number };
    const easy: Sugg[] = [], mid: Sugg[] = [], hard: Sugg[] = [];
    const optional = inp.recurrings.filter((x) => isOptional(x, key)).map((x) => ({ x, m: Math.round(yearlyCents(x) / 12) })).filter((o) => o.m > 0).sort((a, b) => b.m - a.m);
    const goalIc = 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2', savIc = 'M19 7h-1V5a3 3 0 0 0-6 0v2H5v13h14zM14 5a1 1 0 0 1 2 0v2h-2z';
    // simples
    if (daily > 0) easy.push({ id: 'daily', text: fill(L('Gasta menos {v} por dia no dia a dia e poupas {m} no mês.'), { v: money(Math.round(est.dailyCents * 0.1)), m: money(Math.round(daily * 0.1)) }), save: Math.round(daily * 0.1), to: '', cut: 0.1, icon: IC.bag });
    const top = catsAvg.find((c) => !inp.budgets.some((b) => b.categoryId === c.id && b.year === ny && b.month === nm + 1));
    if (top && top.avg >= 2000) easy.push({ id: 'lim', text: fill(L('Define um limite de {l} para {c} (menos 15% do que costumas gastar).'), { l: money(Math.round(top.avg * 0.85)), c: catName(top.id) || L('Outras despesas') }), save: Math.round(top.avg * 0.15), to: `/orcamentos?novo=1&cat=${encodeURIComponent(top.id)}&valor=${Math.round(top.avg * 0.85)}`, icon: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z' });
    if (tips && optional.length) { const o = optional[optional.length - 1]; easy.push({ id: 'sub1', text: fill(L('Cancela {n}: são {m}/mês que ficam para ti.'), { n: o.x.description, m: money(o.m) }), save: o.m, to: `/subscricoes?cortar=${o.x.id}`, icon: IC.fixed }); }
    // moderadas
    if (tips && optional.length >= 2) { const two = optional.slice(0, 2), m = two.reduce((a, o) => a + o.m, 0); mid.push({ id: 'sub2', text: fill(L('Cancela {n}: são {m}/mês que ficam para ti.'), { n: two.map((o) => o.x.description).join(` ${L('e')} `), m: money(m) }), save: m, to: `/subscricoes?cortar=${two.map((o) => o.x.id).join(',')}`, icon: IC.fixed }); }
    if (gap > 0 && goals.length) { const g = [...goals].sort((a, b) => b.need - a.need)[0]; if (g.need > 0) mid.push({ id: 'goal', text: fill(L('Dá mais tempo à meta {n}: hoje precisa de {v}/mês.'), { n: g.name, v: money(g.need) }), save: Math.round(g.need / 2), to: `/metas?meta=${g.id}${g.later ? '&data=' + g.later : ''}`, icon: goalIc }); }
    if (gap > 0 && savPlan > 0) mid.push({ id: 'sav2', text: fill(L('Põe metade na poupança automática este mês ({v} em vez de {t}).'), { v: money(Math.round(savPlan / 2)), t: money(savPlan) }), save: Math.round(savPlan / 2), to: savTo(Math.round(savTopM / 2)), icon: savIc });
    // fortes: só quando o mês não fecha e as outras não chegam
    const soft = [...easy, ...mid].reduce((a, x) => a + x.save, 0);
    if (gap > 0 && soft < gap) {
      if (goalNeed > 0) hard.push({ id: 'goal0', text: fill(L('Pausa as metas este mês: são {v} que ficam livres.'), { v: money(goalNeed) }), save: goalNeed, to: '/metas?pausar=1', icon: goalIc });
      if (savPlan > 0) hard.push({ id: 'sav0', text: fill(L('Pausa a poupança automática este mês ({v}).'), { v: money(savPlan) }), save: savPlan, to: savTo(0), icon: savIc });
      if (daily > 0) hard.push({ id: 'daily25', text: fill(L('Corta um quarto no dia a dia: gasta menos {v} por dia.'), { v: money(Math.round(est.dailyCents * 0.25)) }), save: Math.round(daily * 0.25), to: '', cut: 0.25, icon: IC.bag });
    }
    const lvl = (k: 'easy' | 'mid' | 'hard', l: Sugg[]) => { const items = l.sort((a, b) => b.save - a.save).slice(0, 2); return { k, items, total: items.reduce((a, x) => a + x.save, 0) }; };
    const sugg = [lvl('easy', easy), lvl('mid', mid), lvl('hard', hard)].filter((x) => x.items.length > 0);
    // detalhes para as caixas que abrem
    const fixedList = p.events.filter((e) => e.kind === 'recurring' || e.kind === 'oneoff').map((e) => ({ id: e.id, label: e.label, date: e.date, cents: -e.cents, catId: inp.recurrings.find((x) => x.id === e.sourceId)?.categoryId ?? '' }));
    const debtList = [...p.events.filter((e) => e.kind === 'instalment').map((e) => ({ id: e.id, label: e.label || L('Prestação'), cents: -e.cents, note: '', planned: false, date: e.date })),
      ...p.partial.flatMap((x) => (x.kind === 'debtNoSchedule' ? [{ id: 'd' + x.accountId, label: x.name, cents: x.monthlyCents, note: '', planned: true, date: '' }] : []))];
    const oneOffs = (est.oneOffs ?? []).filter((x) => x.date >= hs && x.date < he);
    const dailyInfo = { months: est.months || 1, perDay: est.dailyCents, cats: catsAvg.slice(0, 6), oneOffs, widened: !!est.widened };
    const saveList = [...inp.accounts.filter((a) => a.type === 'savings' && (splitDesc(a.description).plan?.monthlyCents ?? 0) > 0).map((a) => ({ id: 'a' + a.id, label: a.name, cents: splitDesc(a.description).plan!.monthlyCents, note: '', to: '/contas?tab=savings' })),
      ...goals.map((g) => ({ id: 'g' + g.id, label: g.name, cents: g.need, note: fill(g.until ? L('Faltam {v} · até {d}') : L('Faltam {v}'), { v: money(g.left), d: g.until ? new Date(g.until.slice(0, 10) + 'T12:00:00').toLocaleDateString(s.language, { month: 'short', year: 'numeric' }) : '' }), to: '/metas', ratio: g.ratio }))];
    const cutCats = catsAvg.slice(0, 5).map((c) => ({ ...c, items: [...byDesc.values()].filter((o) => o.cat === c.id && o.name).sort((a, b) => b.cents - a.cents).slice(0, 3).map((o) => ({ name: o.name, avg: Math.round(o.cents / hm), times: Math.max(1, Math.round(o.n / hm)) })) }));
    return { start, income, used, fixed, debts, daily, spend, saveTarget, left, tone, weights, fixedList, debtList, dailyInfo, saveList, sugg, gap, cutCats, hasIncome: income > 0, enough: income > 0 && (est.ok || fixed > 0), steps: { income: income > 0, spend: inp.txs.some((x) => x.type === 'expense'), recurring: inp.recurrings.some((x) => x.type === 'expense'), goal: inp.goals.length > 0 } };
  }, [inp, cats, extras, tips]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthName = r ? new Date(r.start + 'T12:00:00').toLocaleDateString(lang, { month: 'long', year: 'numeric' }) : '';
  const free = Math.max(0, r?.left ?? 0);
  const del = async (x: SimBuy) => { if (await appConfirm(fill(L('Apagar a simulação {n}?'), { n: x.name || L('Compra') }), { danger: true, ok: L('Apagar') })) { const l = sims.filter((y) => y.id !== x.id); setSims(l); saveSims(l); } };
  const TONE: Record<Tone, [string, string]> = {
    ok: [L('Está tudo em ordem'), L('As tuas despesas, dívidas, poupanças e metas cabem no mês. Continua assim! 💪')],
    meh: [L('Mais ou menos'), L('Cabe tudo, mas fica pouca folga para imprevistos.')],
    tight: [L('A gestão está apertada'), L('Com o que costumas gastar, não chega para tudo o que planeaste.')],
  };

  const mob = !PC_MOBILE;
  const tabs = (['w', ...(r && r.tone !== 'ok' && r.sugg.length > 0 ? ['s'] : [])] as Array<'w' | 's'>);
  const curTab = tabs.includes(tab) ? tab : 'w';
  const healthEl = r && (
          <section className={'mv-card pl3-health ' + r.tone}>
            <div className="pco-mhead"><span className="pco-mic"><Ic d="M3 17l6-6 4 4 8-8M14 7h7v7" size={18} /></span><h3>{L('Para onde vai o teu dinheiro')}</h3></div>
            {(() => {
              const parts = ([
                ['fix', L('Contas fixas'), L('Pagamentos que se repetem: renda, internet, subscrições…'), r.fixed],
                ['daily', L('Despesas do dia a dia'), L('O que costumas gastar em compras, comida, transportes…'), r.daily],
                ['debt', L('Dívidas'), L('Prestações dos teus empréstimos'), r.debts],
                ['save', L('Poupanças e metas'), L('O que queres pôr de lado este mês'), r.saveTarget],
                ['left', r.left >= 0 ? L('Sobra') : L('Em falta'), r.left >= 0 ? L('Fica livre depois de tudo') : L('Não chega para tudo: é quanto falta'), Math.abs(r.left)],
              ] as const).filter(([, , , v]) => v > 0);
              const base = Math.max(1, r.left >= 0 ? r.income : r.spend + r.saveTarget);
              return <>
                <p className="pl3-lead">{L('Ganhas cerca de')} <strong className="inc"><CountMoney cents={r.income} money={money} /></strong> {L('por mês. Para pagar tudo e cumprir as poupanças e metas precisas de')} <strong className={r.left < 0 ? 'need over' : 'need'}><CountMoney cents={r.spend + r.saveTarget} money={money} /></strong>{r.left < 0 ? <> — <strong className="miss">{L('faltam')} <CountMoney cents={-r.left} money={money} /></strong></> : <> — <strong className="spare">{L('sobram')} <CountMoney cents={r.left} money={money} /></strong></>}</p>
                <div className="pl3-bar" role="img" aria-label={L('Para onde vai o teu rendimento')}>
                  {parts.map(([k, label, , v], i) => <i key={k} tabIndex={0} className={k + (k === 'left' && r.left < 0 ? ' over' : '')} style={{ '--i': i, '--g': v / base } as CSSProperties} aria-label={`${label}: ${money(v)}`}><span className="pl3-btip" role="tooltip"><b>{label}</b><em>{k === 'left' && r.left < 0 ? '−' : ''}{money(v)}</em><small className={'pl3-btipct ' + pctTone(k, v / Math.max(1, r.income), r.left)}><strong>{Math.round((v / Math.max(1, r.income)) * 100)}%</strong> {L('do que ganhas')}</small></span></i>)}
                </div>
                <div className="pl3-legend">
                  {parts.map(([k, label, sub, v], i) => (
                    <Fragment key={k}><button type="button" disabled={k === 'left'} aria-expanded={openPart === k} onClick={() => setOpenPart(openPart === k ? null : k)} className={'pl3-lg ' + k + (k === 'left' && r.left < 0 ? ' over' : '') + (openPart === k ? ' open' : '')} style={{ '--i': i } as CSSProperties}>
                      <span className="pl3-dot" /><span className="pl3-lgt"><b>{label}</b><small>{sub}</small></span>
                      <span className="pl3-lgv"><b>{k === 'left' && r.left < 0 ? '−' : ''}<CountMoney cents={v} money={money} /></b><small className={'pl3-pct ' + pctTone(k, v / Math.max(1, r.income), r.left)}><strong><CountText text={`${Math.round((v / Math.max(1, r.income)) * 100)}%`} /></strong> {L('do que ganhas')}</small></span><span className={'pl3-lgchev' + (k === 'fix' || k === 'daily' || k === 'debt' || k === 'save' ? '' : ' ghost')} aria-hidden="true"><Ic d={ICON.down} size={15} /></span>
                    </button>
                    {openPart === k && <PartDetail k={k} r={r} cats={cats} money={money} catName={catName} lang={lang} />}</Fragment>))}
                </div>
              </>;
            })()}
          </section>
  );
  const weighIn = r && (<>
            {r.tone === 'ok' ? <>
              <div className="pco-mhead"><span className="pco-mic"><Ic d={IC.free} size={18} /></span><h3>{L('Bom caminho')}</h3></div>
              <div className="pl3-cheer">
                <span className="pl3-cheer-art" aria-hidden="true"><i /><i /><b>🎯</b></span>
                <div className="pl3-cheer-tx">
                  <small>{L('Depois de cumprires tudo, sobram')}</small>
                  <strong><CountMoney cents={r.left} money={money} /></strong>
                  <p>{L('Que tal pôr este dinheiro a trabalhar por ti?')}</p>
                </div>
                <div className="pl3-cheer-acts">
                  <Link className="pl3-cta" to="/metas"><Ic d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zM12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" size={16} />{L('Reforçar uma meta')}<Ic d="M5 12h14M13 6l6 6-6 6" size={15} /></Link>
                  <Link className="pl3-cta ghost" to="/contas?tab=savings"><Ic d="M19 7h-1V5a3 3 0 0 0-6 0v2H5v13h14zM14 5a1 1 0 0 1 2 0v2h-2z" size={16} />{L('Guardar para imprevistos')}<Ic d="M5 12h14M13 6l6 6-6 6" size={15} /></Link>
                </div>
              </div>
            </> : <>
              <div className="pco-mhead"><span className="pco-mic"><Ic d={IC.weight} size={18} /></span><h3>{L('O que está a pesar mais')}</h3></div>
              {r.weights.map((w, i) => <Link key={w.id} to={w.to} className="pl3-weight" style={{ '--i': i, '--w': `${Math.min(100, (w.cents / Math.max(1, r.income)) * 100)}%` } as CSSProperties}>
                {w.catId ? <CatIcon cat={cats.find((c) => c.id === w.catId) ?? {}} size={32} /> : <span className={'txs-tric pl3-wic ' + w.id}><Ic d={w.id === 'debt' ? 'M3 10l9-6 9 6M5 10v9h14v-9' : 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zM12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2z'} size={16} /></span>}
                <span className="pl3-wtx"><b>{w.label}</b><small>{w.sub}</small><i /></span><span className="pl3-wv"><em>{money(w.cents)}<small>/{L('mês')}</small></em><small className={'pl3-wpct pl3-pct ' + pctTone('exp', w.cents / Math.max(1, r.income), 0)}><strong>{Math.round((w.cents / Math.max(1, r.income)) * 100)}%</strong> {L('do que ganhas')}</small></span></Link>)}
              <div className="pl3-dend pl3-wend"><Foot text={L('As despesas que levam a maior parte do teu dinheiro todos os meses. Toca numa para ver ou mudar.')} /></div>
            </>}
  </>);
  const suggIn = r && (<>
                <div className="pco-mhead"><span className="pco-mic"><Ic d={IC.bulb} size={18} /></span><h3>{L('O que podes fazer')}</h3></div>
                <p className="pl3-lvlintro"><Ic d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" size={15} />{L('Todas estas medidas aliviam o teu mês. Quanto mais forte a medida, mais dinheiro fica livre para as tuas metas e imprevistos.')}</p>
                {r.sugg.map((g, gi) => <div key={g.k} className={'pl3-lvl ' + g.k} style={{ '--i': gi } as CSSProperties}>
                  <div className="pl3-lvlh"><span className="pl3-lvlic"><Ic d={g.k === 'easy' ? 'M20 6 9 17l-5-5' : g.k === 'mid' ? 'M12 3v18M5 12h14' : 'M13 2 4 14h7l-1 8 9-12h-7z'} size={13} /></span>
                    <span className="pl3-lvlt"><b>{g.k === 'easy' ? L('Ajustes simples') : g.k === 'mid' ? L('Mudanças moderadas') : L('Medidas mais fortes')}</b><small>{g.k === 'easy' ? L('Fáceis de fazer, quase não se notam.') : g.k === 'mid' ? L('Pedem algum esforço, mas fazem diferença.') : L('Só se as outras não chegarem.')}</small></span>
{r.gap > 0 && g.total >= r.gap && <em className="pl3-lvlok pl3-lvlok-top"><Ic d="M20 6 9 17l-5-5" size={12} />{L('Chega para fechar o mês')}</em>}</div>
                  <div className="pl3-lvlmeta">
                    <span className="pl3-relief" aria-label={L('Alívio')}><small>{L('Alívio')}</small>{[0, 1, 2].map((k) => <i key={k} className={k <= (g.k === 'easy' ? 0 : g.k === 'mid' ? 1 : 2) ? 'on' : ''} />)}</span>
                    <em className="pl3-lvlsum">{fill(L('liberta até {v}/mês'), { v: money(g.total) })}</em>
                  </div>
                  {g.items.map((x, i) => { const inner = <><span><Ic d={x.icon} size={16} /></span><p>{x.text}</p><em>+{money(x.save)}<i>/{L('mês')}</i></em><Ic d="M9 6l6 6-6 6" size={15} /></>;
                    return x.cut ? <button key={x.id} type="button" className="pl3-sugg" style={{ '--i': gi * 2 + i } as CSSProperties} onClick={() => setCut(x.cut!)}>{inner}</button>
                      : <Link key={x.id} to={x.to} className="pl3-sugg" style={{ '--i': gi * 2 + i } as CSSProperties}>{inner}</Link>; })}
                </div>)}
  </>);
  const simsIn = r && (<>
            <div className="pco-mhead"><span className="pco-mic"><Ic d={IC.bag} size={18} /></span><h3>{L('Compras simuladas')}</h3><button type="button" className="mv-link pl3-new" onClick={() => setOpen('new')}><Ic d={ICON.plus} size={14} />{L('Simular')}</button></div>
            {sims.length === 0 ? <button type="button" className="pl3-empty" onClick={() => setOpen('new')}><span><Ic d={IC.bag} size={26} /></span><b>{L('Queres comprar alguma coisa?')}</b><small>{L('Simula e vê se cabe no teu mês antes de comprar.')}</small></button>
              : <div className="pl3-simlist">{sims.map((x, i) => { const f = fitOf(perMonthOf(x), free); return (
                <div key={x.id} className="pl3-sim" style={{ '--i': i } as CSSProperties}>
                  <button type="button" className="pl3-simb" onClick={() => setOpen(x)}><CatIcon cat={cats.find((c) => c.id === x.categoryId) ?? {}} size={34} /><span className="sh-tx-main"><b>{x.name || L('Compra')}</b><small>{money(x.cents)}{x.inst ? ` · ${x.months}x ${money(perMonthOf(x))}` : ''}</small></span>
                    <em className={'pl3-fit ' + f}>{f === 'ok' ? L('Cabe') : f === 'meh' ? L('À justa') : L('Não cabe')}</em></button>
                  <button type="button" className="pl3-del" onClick={() => del(x)} aria-label={L('Apagar')}><Ic d={ICON.trash} size={15} /></button>
                </div>); })}</div>}
  </>);

  return (
    <div className={'fx-page mv sh pl3' + (mob ? ' pl3m' : '')}>
      <header className="mv-head"><h1 className="sh-title">{L('Planeamento')}</h1></header>
      <div className="pl3-top">
        <span className="pl3-month"><span className="pl3-mcal"><Ic d="M5 5h14v15H5zM5 10h14M8 3v4M16 3v4" size={18} /></span><span className="pl3-mtx"><small>{L('A planear o próximo mês')}</small><b>{monthName.charAt(0).toUpperCase() + monthName.slice(1)}</b></span></span>
        <div className={'pl3-tog pl3-tog-head' + (extras ? ' r' : '')} role="tablist" aria-label={L('Rendimento a contar')}>
                <span className="pl3-togpill" aria-hidden="true" />
                <button type="button" role="tab" aria-selected={!extras} className={!extras ? 'on' : ''} onClick={() => setInc(false)}><Ic d="M3 7h18v12H3zM3 11h18M7 15h3" size={16} />{L('Só salário')}</button>
                <button type="button" role="tab" aria-selected={extras} className={extras ? 'on' : ''} onClick={() => setInc(true)}><Ic d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" size={16} />{L('Com extras')}</button>
              </div>
      </div>

      {r && !r.enough && <NotEnough steps={r.steps} />}
      {r && r.enough && mob && <>
        {/* telemóvel: resumo num só cartão, gráfico compacto e o resto em separadores */}
        <section className={'mv-card pl3-hero ' + r.tone}>
          <div className="pl3-hhead"><span className="pl3-hic"><Ic d={r.tone === 'ok' ? 'M20 6 9 17l-5-5' : 'M12 8v5M12 16h.01M12 3l9 16H3z'} size={16} /></span><b>{TONE[r.tone][0]}</b><span className="pl3-sinfo" tabIndex={0} aria-label={L('Estimativa a partir dos teus dados. Não é uma garantia.')}><Ic d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 16v-4M12 8h.01" size={15} /><span role="tooltip">{L('Estimativa a partir dos teus dados. Não é uma garantia.')}</span></span></div>
          <div className="pl3-hbig"><small>{r.left < 0 ? L('Faltam') : L('Sobram')}</small><strong><CountMoney cents={Math.abs(r.left)} money={money} /></strong></div>
          <span className="pl3-hbar" aria-hidden="true"><i style={{ width: `${Math.min(100, ((r.spend + r.saveTarget) / Math.max(1, r.income)) * 100)}%` }} /></span>
          <div className="pl3-hstats">
            <span><small>{L('Ganhas')}</small><b className="inc"><CountMoney cents={r.income} money={money} /></b></span>
            <span><small>{L('Precisas')}</small><b><CountMoney cents={r.spend + r.saveTarget} money={money} /></b></span>
          </div>
        </section>
        {healthEl}
        <section className={'mv-card pl3-box pl3-tabcard' + (tabs.length === 1 ? ' solo' : '')}>
          {tabs.length > 1 && <div className={'pl3-tabs t' + tabs.indexOf(curTab)} style={{ '--n': tabs.length } as CSSProperties} role="tablist">
            <span className="pl3-tabpill" aria-hidden="true" />
            {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={curTab === k} className={curTab === k ? 'on' : ''} onClick={() => setTab(k)}>
              <Ic d={k === 'w' ? IC.weight : IC.bulb} size={15} />{k === 'w' ? L('O que está a pesar mais') : L('O que podes fazer')}</button>)}
          </div>}
          <div key={curTab} className="pl3-tabpane">{curTab === 'w' ? weighIn : suggIn}</div>
        </section>
        <section className="mv-card pl3-box pl3-sims">
          {simsIn}
        </section>
      </>}

      {r && r.enough && !mob && <>

        {/* 2. para onde vai o dinheiro (sozinho numa fila: ao abrir linhas empurra o resto para baixo) */}
        <div className="pl3-row pl3-full">
          {healthEl}
        </div>

        {/* 2. resumo: rendimento, compromissos, sobra/falta e estado do mês */}
        <div className="pl3-kpis">
            <Metric i={0} icon={IC.inc} tone="inc" title={L('Rendimento previsto')} value={r.income} money={money} sub={fill(L('Média do que recebeste nos últimos {n} meses.'), { n: String(r.used) })} under={String(r.used)} underLabel={r.used === 1 ? L('mês') : L('meses')} ratio={1} />
            <Metric i={1} icon={IC.fixed} tone="exp" title={L('Compromissos do mês')} value={r.spend + r.saveTarget} money={money} sub={L('Despesas fixas, dia a dia, dívidas, poupanças e metas do próximo mês.')} ratio={(r.spend + r.saveTarget) / Math.max(1, r.income)} pct={r.hasIncome ? (r.spend + r.saveTarget) / r.income : undefined} />
            <Metric i={2} icon={IC.free} tone={r.left < 0 ? 'exp' : 'sav'} title={r.left < 0 ? L('Falta para cumprir tudo') : L('Livre depois de cumprir tudo')} value={Math.abs(r.left)} money={money} sub={r.left < 0 ? L('Quanto falta para pagares tudo e cumprires as poupanças e metas.') : L('O que fica livre depois de pagares tudo e cumprires as poupanças e metas.')} ratio={Math.abs(r.left) / Math.max(1, r.income)} pct={r.hasIncome ? Math.abs(r.left) / r.income : undefined} />
          <section className={'mv-card pco-metric pl3-metric pl3-state ' + r.tone} style={{ '--i': 3 } as CSSProperties}>
            <div className="pco-mhead"><span className="pco-mic"><Ic d={r.tone === 'ok' ? 'M20 6 9 17l-5-5' : 'M12 8v5M12 16h.01M12 3l9 16H3z'} size={18} /></span><h3>{L('Estado do mês')}</h3><span className="pl3-sinfo" tabIndex={0} aria-label={L('Estimativa a partir dos teus dados. Não é uma garantia.')}><Ic d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 16v-4M12 8h.01" size={15} /><span role="tooltip">{L('Estimativa a partir dos teus dados. Não é uma garantia.')}</span></span></div>
            <strong className="pco-value pl3-statev"><span className="pl3-semo" aria-hidden="true">{r.tone === 'ok' ? '💪' : r.tone === 'meh' ? '⚖️' : '⚠️'}</span>{TONE[r.tone][0]}</strong>
            <span className="pl3-statet2"><Ic d={r.tone === 'ok' ? 'M20 6 9 17l-5-5' : r.tone === 'meh' ? 'M5 12h14' : 'M12 5v14M5 12l7 7 7-7'} size={13} />{!r.hasIncome ? L('Regista o teu salário') : r.tone === 'tight' ? L('Não chega para tudo o que planeaste') : r.tone === 'meh' ? L('Cabe tudo, com pouca folga') : L('Cabe tudo. Continua assim!')}</span>
          </section>
        </div>

        {/* 3. o que pesa + o que podes fazer | compras simuladas (estica até à mesma altura) */}
        <div className="pl3-row pl3-row2">
          <div className="pl3-col">
          <section className="mv-card pl3-box">
            {weighIn}
          </section>
          <section className="mv-card pl3-box pl3-sims pl3-simcomp">
            {simsIn}
          </section>
          </div>
          {r.tone !== 'ok' && r.sugg.length > 0 && <section className="mv-card pl3-box pl3-stretch pl3-suggbox">
                {suggIn}
          </section>}
        </div>
      </>}

      {cut !== null && r && <CutSheet pct={cut} r={r} cats={cats} money={money} onClose={() => setCut(null)} />}
      {open && inp && r && <BuySim init={open === 'new' ? null : open} free={free} cats={cats} inp={inp} money={money}
        onClose={() => setOpen(null)}
        onSave={(x) => { const l = [x, ...sims.filter((y) => y.id !== x.id)]; setSims(l); saveSims(l); setOpen(null); }}
        onDone={(id) => { if (id) { const l = sims.filter((y) => y.id !== id); setSims(l); saveSims(l); } setOpen(null); }} />}
    </div>
  );
}

function Metric({ i, icon, tone, title, value, money, ratio, pct, under, underLabel, children }: { under?: string; underLabel?: string; pct?: number; i: number; icon: string; tone: string; title: string; value: number; money: (c: number) => string; sub: string; ratio: number; children?: React.ReactNode }) {
  return (
    <section className={'mv-card pco-metric pl3-metric ' + tone} style={{ '--i': i } as CSSProperties}>
      <div className="pco-mhead"><span className="pco-mic"><Ic d={icon} size={18} /></span><h3>{title}</h3>{pct !== undefined ? <span className={'pco-delta pl3-delta ' + tone}><CountText text={`${Math.round(pct * 100)}%`} /> <small>{L('do rendimento')}</small></span> : under ? <span className={'pco-delta pl3-delta ' + tone}><small>{L('média de')}</small> <CountText text={under} /> <small>{underLabel}</small></span> : null}</div>
      <strong className="pco-value pl3-mval"><CountMoney cents={value} money={money} /></strong>
      <span className="pl3-mbar" aria-hidden="true"><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></span>
      {children}
    </section>
  );
}

/** Simular uma compra: cabe no que sobra depois de cumprir tudo? Pode ser às prestações. Guardar para mais tarde,
 *  adicionar como despesa (ou criar a dívida, se for às prestações) ou apagar. */
function BuySim({ init, free, cats, inp, money, onClose, onSave, onDone }: { init: SimBuy | null; free: number; cats: Category[]; inp: PlanInput; money: (c: number) => string; onClose: () => void; onSave: (x: SimBuy) => void; onDone: (id: string | null) => void }) {
  const navigate = useNavigate();
  const accs = inp.accounts.filter((a) => a.type !== 'debt');
  const [name, setName] = useState(init?.name ?? ''), [amt, setAmt] = useState(init ? String(init.cents / 100).replace('.', ',') : '');
  const [cat, setCat] = useState(init?.categoryId ?? ''), [acc, setAcc] = useState(init?.accountId || accs.find((a) => a.isDefault)?.id || accs[0]?.id || '');
  const [date, setDate] = useState(init?.date ?? inp.today), [inst, setInst] = useState(init?.inst ?? false), [n, setN] = useState(String(init?.months ?? 12)), [busy, setBusy] = useState(false);
  const [group, setGroup] = useState(init?.groupId ?? ''), [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { db.groups.toArray().then((g) => setGroups(g.filter((x) => x.deletedAt === null))).catch(() => {}); }, []);
  const bals = useMemo(() => { const [ty, tm] = inp.today.split('-').map(Number), sal = salariesUntil(inp.salaries, ty, tm), txs = inp.txs.filter((x) => x.date <= inp.today), trs = inp.transfers.filter((x) => x.date <= inp.today);
    return Object.fromEntries(accs.map((a) => [a.id, accountBalanceCents(a, txs, inp.accounts, sal, trs)])); }, [inp, accs]);
  const total = Math.abs(parseMoneyToCents(amt || '0') ?? 0), months = Math.max(2, Number(n) || 12);
  const perMonth = perMonthOf({ cents: total, inst, months }), fit = fitOf(perMonth, free), left = free - perMonth;
  // valor e categoria são obrigatórios (para guardar e para adicionar)
  const missing = useMissing();
  const miss = missing([['amt', L('o valor'), total > 0], ['cat', L('a categoria'), !!cat]]);
  const item = (): SimBuy => ({ id: init?.id ?? crypto.randomUUID(), name: name.trim(), cents: total, categoryId: cat, accountId: acc, date, inst, months, groupId: group, createdAt: init?.createdAt ?? new Date().toISOString() });
  const add = async () => {
    if (!miss.check()) return;
    setBusy(true);
    try {
      if (inst) { navigate(`/contas?tab=debt&nova=debt&nome=${encodeURIComponent(name || L('Compra'))}&valor=${total}&mes=${perMonth}`); onDone(init?.id ?? null); return; }
      if (!(await appConfirm(fill(L('Adicionar {n} ({v}) às tuas despesas?'), { n: name || L('Compra'), v: money(total) }), { ok: L('Adicionar'), danger: false }))) return;
      await addTransaction(db, { date, type: 'expense', categoryId: cat, description: name.trim() || L('Compra'), amountCents: total, currency: inp.currency, accountId: acc || undefined, ...(group ? { groupId: group } : {}) });
      window.dispatchEvent(new Event('wallet:tx-saved')); onDone(init?.id ?? null);
    } finally { setBusy(false); }
  };
  return (
    <BottomSheet title={L('Simular compra')} onClose={onClose}>
      <span className="pl2-buyart" aria-hidden="true"><Ic d={IC.bag} size={30} /></span>
      <div className="acc-form pl2-buy">
        <p className="pln-simtag"><Ic d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" size={14} />{L('Simulação: nada é guardado até confirmares.')}</p>
        {miss.note}
        <AmountField value={amt} onChange={setAmt} currency={inp.currency} kind="expense" label={L('Quanto custa')} autoFocus={!init} cls={miss.cls('amt')} />
        <div className="tx-rows">
          <TextRow label={L('O que queres comprar?')} value={name} onChange={setName} placeholder={L('Ex.: Computador')} />
          <CategoryRow cats={cats.filter((c) => c.deletedAt === null)} kind="expense" value={cat} onChange={setCat} required cls={miss.cls('cat')} />
          {accs.length > 0 && <AccountRow label={L('Conta')} value={acc} options={accs.map((a) => ({ id: a.id, name: a.name, right: money(bals[a.id] ?? 0) }))} balance={money(bals[acc] ?? 0)} onChange={setAcc} />}
          <DateRow label={inst ? L('Data do primeiro pagamento') : L('Data')} value={date} onChange={setDate} />
          {groups.length > 0 && <label className="tx-row"><span><Ic d="M4 6h16M4 12h16M4 18h10" size={18} />{L('Grupo')}</span>
            <PickMenu compact label={L('Grupo')} value={group} options={[{ value: '', label: L('Nenhum') }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} onChange={(v) => setGroup(String(v))} /></label>}
          <SwitchRow icon="M5 5h14v15H5zM5 10h14M8 3v4M16 3v4" label={inst ? L('Em quantos meses?') : L('Pagar às prestações?')} sub={inst ? undefined : L('Divide o valor por vários meses')} on={inst} onChange={setInst}><input className="tx-val" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} /></SwitchRow>
        </div>
        {total > 0 && <div className={'pl2-verdict ' + (fit === 'tight' ? 'no' : 'ok') + ' f-' + fit} aria-live="polite">
          <span><Ic d={fit === 'tight' ? 'M12 8v5M12 16h.01M12 3l9 16H3z' : 'M20 6 9 17l-5-5'} size={20} /></span>
          <p><b>{fit === 'ok' ? L('Cabe no teu mês') : fit === 'meh' ? L('Cabe, mas à justa') : L('Não cabe neste mês')}</b><small>{fit === 'tight' ? L('Esta compra tira dinheiro às tuas despesas ou metas.') : fit === 'meh' ? L('Usa mais de metade do que te sobra no mês.') : L('Podes comprar sem pôr em risco as tuas despesas e metas.')}</small></p>
        </div>}
        {total > 0 && <div className="pl2-vnums">
          <div className="out" style={{ '--i': 0 } as CSSProperties}><small>{inst ? fill(L('Pagas por mês ({n}x)'), { n: String(months) }) : L('Custa')}</small><b>{money(perMonth)}</b></div>
          <span>vs</span>
          <div className="free" style={{ '--i': 1 } as CSSProperties}><small>{L('Tens livre por mês')}</small><b>{money(free)}</b></div>
          <span>=</span>
          <div className={left >= 0 ? 'ok' : 'no'} style={{ '--i': 2 } as CSSProperties}><small>{left >= 0 ? L('Ficas com') : L('Faltam')}</small><b>{money(Math.abs(left))}</b></div>
          <p className="pl2-vcap">{L('"Livre" é o que sobra depois das despesas, dívidas, poupanças e metas do mês.')}</p>
        </div>}
        {total > 0 && <div className="pl3-acts">
          <button type="button" className="tx-addbtn" disabled={busy} onClick={add}>{inst ? L('Criar conta de dívida com estes dados') : L('Adicionar como despesa')}</button>
          <button type="button" className="sh-btn out pl3-later" onClick={() => { if (miss.check()) onSave(item()); }}><Ic d="M6 3h12v18l-6-4-6 4z" size={17} />{init ? L('Guardar alterações') : L('Guardar para mais tarde')}</button>
          {init && <button type="button" className="gx-rm" onClick={() => onDone(init.id)}><Ic d={ICON.trash} size={16} />{L('Apagar simulação')}</button>}
        </div>}
      </div>
    </BottomSheet>
  );
}

/** O que está por trás de cada parte: contas fixas, dia a dia normal (por categoria), dívidas, poupanças e metas.
 *  A lista vem primeiro; a explicação de como foi calculado fica em baixo, discreta. */
type DetailData = { fixedList: Array<{ id: string; label: string; date: string; cents: number; catId: string }>; debtList: Array<{ id: string; label: string; cents: number; note: string; planned: boolean; date: string }>; saveList: Array<{ id: string; label: string; cents: number; note: string; to: string; ratio?: number }>; dailyInfo: { months: number; perDay: number; widened: boolean; cats: Array<{ id: string; avg: number }>; oneOffs: Array<{ id: string; description: string; amountCents: number; date: string; categoryId: string }> } };
const Foot = ({ text }: { text: string }) => <p className="pl3-dfoot"><Ic d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 16v-4M12 8h.01" size={14} /><span>{text}</span></p>;
function PartDetail({ k, r, cats, money, catName, lang }: { k: string; r: DetailData; cats: Category[]; money: (c: number) => string; catName: (id: string) => string; lang: string }) {
  const [showOff, setShowOff] = useState(false);
  const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  const cat = (id: string) => cats.find((c) => c.id === id) ?? {};
  if (k === 'fix') return (
    <div className="pl3-detail">
      {r.fixedList.length === 0 ? <p className="pl3-dnote">{L('Não há pagamentos marcados para o próximo mês.')}</p> : r.fixedList.map((x, i) => <div key={x.id} className="sh-tx pl3-drow" style={{ '--i': i } as CSSProperties}><CatIcon cat={cat(x.catId)} size={30} /><span className="sh-tx-main"><b>{x.label || L('Pagamento')}</b><small>{day(x.date)}</small></span><b>{money(x.cents)}</b></div>)}
      <div className="pl3-dend"><Foot text={L('Pagamentos recorrentes e despesas já marcadas para o próximo mês.')} /><Link to="/subscricoes" className="mv-link">{L('Ver recorrentes')}</Link></div>
    </div>);
  if (k === 'debt') return (
    <div className="pl3-detail">
      {r.debtList.map((x, i) => <div key={x.id} className={'sh-tx pl3-drow' + (x.planned ? ' plan' : '')} style={{ '--i': i } as CSSProperties}><CatIcon cat={cats.find((c) => c.nameKey === 'catLoan') ?? { nameKey: 'catLoan', icon: 'handcoin' }} size={30} /><span className="sh-tx-main"><b>{x.label}</b><small>{x.planned ? <span className="pl3-dtag"><i aria-hidden="true" />{L('Ainda sem pagamento automático')}</span> : <span className="pl3-dtag ok"><Ic d="M20 6 9 17l-5-5" size={11} />{x.date ? fill(L('Agendado para {d}'), { d: new Date(x.date + 'T12:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'long' }) }) : L('Pagamento já agendado')}</span>}</small></span><b>{money(x.cents)}</b></div>)}
      <div className="pl3-dend">{r.debtList.length > 0 ? <Foot text={r.debtList.some((x) => x.planned) ? L('É o que planeaste pagar por mês. Agenda-o nas Dívidas para não te esqueceres.') : L('Estes pagamentos já estão agendados: saem sozinhos da tua conta nas datas indicadas.')} /> : <span />}<Link to="/contas?tab=debt" className="mv-link">{L('Ver dívidas')}</Link></div>
    </div>);
  if (k === 'save') return (
    <div className="pl3-detail">
      {r.saveList.length === 0 ? <p className="pl3-dnote">{L('Ainda não tens metas com data nem contas de poupança com um valor por mês.')}</p> : r.saveList.map((x, i) => (
        <Link key={x.id} to={x.to} className="sh-tx pl3-drow" style={{ '--i': i } as CSSProperties}>
          <span className={'txs-tric ' + (x.id[0] === 'g' ? 'pl3-icg' : 'pl3-ics')}><Ic d={x.id[0] === 'g' ? 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z' : 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2z'} size={15} /></span>
          <span className="sh-tx-main"><b>{x.label}</b>{x.note && <small>{x.note}</small>}{x.ratio !== undefined && <span className="pl3-gbar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(2, x.ratio * 100))}%` }} /><em>{Math.round(x.ratio * 100)}%</em></span>}</span><b className="pl3-gneed">{money(x.cents)}<i className="pl3-per">/{L('mês')}</i></b>
        </Link>))}
      <div className="pl3-dend"><Foot text={L('O que as metas precisam por mês para chegares a tempo e o que planeaste pôr nas contas de poupança.')} /><Link to="/metas" className="mv-link">{L('Ver metas')}</Link></div>
    </div>);
  const d = r.dailyInfo, max = Math.max(1, ...d.cats.map((c) => c.avg));
  return (
    <div className="pl3-detail">
      {d.cats.map((c, i) => <div key={c.id} className="pl3-dcat" style={{ '--i': i, '--w': `${(c.avg / max) * 100}%` } as CSSProperties}><span className="pl3-dic"><CatIcon cat={cat(c.id)} size={28} /></span><span className="pl3-dct"><b>{catName(c.id) || L('Outras despesas')}</b><i /></span><em>{money(c.avg)}</em></div>)}
      {d.oneOffs.length > 0 && (() => {
        const total = d.oneOffs.reduce((a, x) => a + x.amountCents, 0);
        return <div className={'pl3-off ' + (showOff ? 'open' : '')}>
          <button type="button" aria-expanded={showOff} onClick={() => setShowOff(!showOff)} className="pl3-offhead">
            <span className="pl3-offic"><Ic d="M12 8v5M12 16h.01M12 3l9 16H3z" size={15} /></span>
            <span className="pl3-offtx"><b>{L('Gastos pontuais fora da média')}</b><small>{fill(L('{n} gastos que não se repetem'), { n: String(d.oneOffs.length) })}</small></span>
            <span className="pl3-offv"><b>{money(total)}</b><small>{L('fora da média')}</small></span>
            <span className="pl3-lgchev"><Ic d={ICON.down} size={14} /></span>
          </button>
          {showOff && d.oneOffs.map((x, i) => <div key={x.id} className="sh-tx pl3-drow off" style={{ '--i': i } as CSSProperties}><CatIcon cat={cat(x.categoryId)} size={30} /><span className="sh-tx-main"><b>{x.description || catName(x.categoryId)}</b><small>{day(x.date)}</small></span><b>{money(x.amountCents)}</b></div>)}
        </div>;
      })()}
      <div className="pl3-dend"><Foot text={fill(d.widened ? L('Os últimos meses tiveram gastos fora do normal, por isso a média usa {n} meses: cerca de {v} por dia.') : L('Média dos últimos {n} meses completos: cerca de {v} por dia.'), { n: String(d.months), v: money(d.perDay) })} /><Link to="/transacoes" className="mv-link">{L('Ver transações')}</Link></div>
    </div>);
}

/** Onde dá para cortar no dia a dia: as categorias onde mais gastas e os sítios onde mais compras. */
function CutSheet({ pct, r, cats, money, onClose }: { pct: number; r: { daily: number; cutCats: Array<{ id: string; avg: number; items: Array<{ name: string; avg: number; times: number }> }> }; cats: Category[]; money: (c: number) => string; onClose: () => void }) {
  const { t } = useTranslation();
  const goal = Math.round(r.daily * pct);
  return (
    <BottomSheet title={L('Onde podes cortar')} onClose={onClose}>
      <div className="acc-form pl3-cut">
        <div className="pl3-cut-hero"><span><Ic d={IC.bag} size={22} /></span><div><small>{L('Objetivo')}</small><b>{fill(L('Poupar {v} por mês'), { v: money(goal) })}</b><p>{fill(L('Basta gastar menos {p}% nestas despesas do dia a dia. Toca numa para ver os movimentos.'), { p: String(Math.round(pct * 100)) })}</p></div></div>
        {r.cutCats.length === 0 && <p className="fx-muted">{L('Ainda não há despesas do dia a dia suficientes para sugerir cortes.')}</p>}
        {r.cutCats.map((c, i) => { const cat = cats.find((x) => x.id === c.id); return (
          <Link key={c.id} to={`/transacoes?categoria=${encodeURIComponent(c.id)}`} className="pl3-cutc" style={{ '--i': i } as CSSProperties} onClick={onClose}>
            <div className="pl3-cuth"><CatIcon cat={cat ?? {}} size={36} /><span className="pl3-cutt"><b>{cat ? catLabel(t, cat) : L('Outras despesas')}</b><small>{fill(L('{v} por mês, em média'), { v: money(c.avg) })}</small></span><em>−{money(Math.round(c.avg * pct))}<i>/{L('mês')}</i></em></div>
            {c.items.length > 0 && <ul>{c.items.map((x) => <li key={x.name}><span>{x.name}</span><small>{x.times}× {L('por mês')}</small><b>{money(x.avg)}</b></li>)}</ul>}
          </Link>); })}
        <Link className="tx-addbtn pl3-cutgo" to="/orcamentos" onClick={onClose}><Ic d="M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z" size={17} />{L('Definir limites para não passar')}</Link>
      </div>
    </BottomSheet>
  );
}

/** Ainda sem dados para planear: o que fazer, passo a passo (cada passo leva ao sítio certo). */
function NotEnough({ steps }: { steps: { income: boolean; spend: boolean; recurring: boolean; goal: boolean } }) {
  const list: Array<[boolean, string, string, string, string]> = [
    [steps.income, 'M3 7h18v12H3zM3 11h18M7 15h3', L('Regista o teu salário'), L('Diz quanto recebes por mês. É a base de todo o plano.'), '/salarios'],
    [steps.spend, 'M12 5v14M5 12l7 7 7-7', L('Adiciona as tuas despesas'), L('Regista o que gastas (ou importa um extrato do banco) durante algumas semanas.'), '/transacoes?nova=1'],
    [steps.recurring, 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', L('Marca os pagamentos fixos'), L('Renda, internet, subscrições… a app conta com eles todos os meses.'), '/subscricoes'],
    [steps.goal, 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z', L('Cria uma meta (opcional)'), L('Para a app saber quanto queres pôr de lado por mês.'), '/metas'],
  ];
  const done = list.filter((x) => x[0]).length;
  return (
    <section className="mv-card pl3-ne">
      <div className="pl3-ne-top">
        <span className="pl3-ne-art" aria-hidden="true"><i /><b>🧭</b></span>
        <div><h2>{L('Ainda não há informação suficiente')}</h2><p>{L('Para planear o próximo mês, a app precisa de conhecer o que recebes e o que gastas. Faz estes passos e o plano aparece aqui sozinho.')}</p></div>
      </div>
      <div className="pl3-ne-prog"><span><i style={{ width: `${(done / list.length) * 100}%` }} /></span><small>{fill(L('{d} de {t} passos feitos'), { d: String(done), t: String(list.length) })}</small></div>
      <div className="pl3-ne-list">{list.map(([ok, d, title, sub, to], i) => (
        <Link key={title} to={to} className={'pl3-ne-step' + (ok ? ' ok' : '')} style={{ '--i': i } as CSSProperties}>
          <span className="pl3-ne-ic">{ok ? <Ic d="M20 6 9 17l-5-5" size={17} /> : <Ic d={d} size={17} />}</span>
          <span className="pl3-ne-tx"><b>{title}</b><small>{ok ? L('Feito ✓') : sub}</small></span>
          {!ok && <Ic d="M9 6l6 6-6 6" size={16} />}
        </Link>))}</div>
    </section>
  );
}
