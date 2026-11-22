// Resumo do PC: Mensal | Anual | Período, caixas de rendimento/gastos/poupança, gráfico, contas,
// últimos movimentos do período, categorias e calendário. Os widgets podem ir para qualquer sítio e mudar de tamanho (Personalizar).
import { useEffect, useRef, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Transaction, Transfer } from '../db/database';
import { accountBalanceCents } from '../core/accounts';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { Ic } from '../ui/fx';
import { AccountBar } from '../ui/AccountBar';
import { PeriodFilter, initialPeriod, periodRange, previousRange, type Period } from '../ui/PeriodFilter';
import { OverviewChart } from './Dashboard';
import { SimpleHome } from './SimpleHome';
import { SimpleOverview } from './SimplePages';
import { AccountsWidget, AssistantWidget, LimitsWidget, PlansWidget, PlanWidget, usePlans } from './PcWidgets';
import { FreeGrid } from '../ui/FreeGrid';
import { addCell, fromOrder, validLayout, type Cell } from '../core/widgetGrid';
import { L } from '../i18n/phrases';
import { cmpShort, cmpText } from '../core/compare';

const IC = {
  income: 'M12 19V5M5 12l7-7 7 7',
  spent: 'M12 5v14M5 12l7 7 7-7',
  saved: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wallet: 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2',
};

// Só a percentagem e "mais/menos" ficam coloridos; o resto igual ao "vs outubro" das outras caixas.
export function CmpWords({ t, pct, name }: { t: ReturnType<typeof useTranslation>['t']; pct: number; name: string }) {
  const full = cmpText(t, pct, name), short = cmpShort(t, pct);
  return full.startsWith(short) ? <>{short} <small>{full.slice(short.length).trim()}</small></> : <small>{full}</small>;
}

export function Metric({ icon, tone, title, value, valueClass, delta, deltaGoodUp, prevName, vsLabel, sub, bar }: {
  icon: string; tone: 'inc' | 'exp' | 'sav'; title: string; value: string; valueClass?: string;
  delta: number | null; deltaGoodUp: boolean; prevName: string; vsLabel: string; sub?: string; bar: number;
}) {
  const { t } = useTranslation();
  const pct = delta === null ? null : Math.round(delta * 100);
  const good = pct === null || pct === 0 ? null : (pct > 0) === deltaGoodUp;
  return (
    <section className={'mv-card pco-metric ' + tone}>
      <div className="pco-mhead">
        <span className="pco-mic"><Ic d={icon} size={18} /></span>
        <h3>{title}</h3>
        {pct !== null ? <span className={'pco-delta ' + (good === null ? 'same' : good ? 'good' : 'bad')}>{deltaGoodUp ? <>{pct > 0 ? '+' : ''}{pct}% <small>{vsLabel} {prevName}</small></> : <CmpWords t={t} pct={pct} name={prevName} />}</span>
          : prevName ? <span className="pco-delta same" title={vsLabel + ' ' + prevName}>— <small>{vsLabel} {prevName}</small></span> : null}
      </div>
      <strong className={'pco-value ' + (valueClass ?? '')}>{value}</strong>
      {sub && <small className="pco-sub">{sub}</small>}
      <div className="pco-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, bar * 100))}%` }} /></div>
    </section>
  );
}

type WidgetId = 'chart' | 'metrics' | 'latest' | 'cats' | 'cal' | 'goals' | 'limits' | 'accounts' | 'groups' | 'assistant' | 'plans';
const ALL_WIDGETS: WidgetId[] = ['chart', 'metrics', 'latest', 'cats', 'cal', 'goals', 'limits', 'accounts', 'groups', 'assistant', 'plans'];
const DEFAULT_ORDER: WidgetId[] = ['chart', 'metrics', 'latest', 'cats', 'cal'];
const ORDER_KEY = 'wallet.pcoOrder.v3'; // disposição antiga (só a ordem)
const LAYOUT_KEY = 'wallet.pcoLayout.v4';
function loadLayout(): Cell[] {
  try {
    const v = validLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'), ALL_WIDGETS);
    if (v) return v;
    const old = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null') as WidgetId[] | null;
    if (Array.isArray(old) && old.length && old.length <= 6 && old.every((x) => ALL_WIDGETS.includes(x)) && new Set(old).size === old.length) return fromOrder(old);
  } catch { /* sem storage */ }
  return fromOrder(DEFAULT_ORDER);
}
const SLIDERS = 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4';
const WNAME: Record<WidgetId, string> = {
  chart: 'Gráfico de rendimentos', metrics: 'Rendimento, gastos e poupança', latest: 'Últimos movimentos', cats: 'Categorias',
  cal: 'Calendário de gastos', goals: 'Metas', limits: 'Limites do mês', accounts: 'Contas', groups: 'Grupos', assistant: 'Assistente IA', plans: 'Poupanças e dívidas',
};

/** Contas, de forma discreta: um botão no topo com o total; ao carregar mostra cada conta. */
function AccountsChip({ money }: { money: (c: number) => string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<{ a: Account; bal: number }>>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (async () => {
      const live = <T extends { deletedAt: string | null }>(r: T[]) => r.filter((x) => x.deletedAt === null);
      const accs = live(await db.accounts.toArray()), txs = live(await db.transactions.toArray());
      const trs = live(await db.transfers.toArray()) as Transfer[], sals = live(await db.salaries.toArray());
      const n = new Date();
      const salaryToDate = sals.filter((x) => x.year * 100 + x.month <= n.getFullYear() * 100 + n.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
      setRows(accs.map((a) => ({ a, bal: accountBalanceCents(a, txs, accs, salaryToDate, trs) })));
    })().catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const total = rows.filter((r) => r.a.type !== 'debt').reduce((s, r) => s + r.bal, 0);
  return (
    <div className="pco-accchip" ref={ref}>
      <button type="button" className="pco-accbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ic d={IC.wallet} size={17} /><span><small>{t('pco.totalAccounts')}</small><b className={total < 0 ? 'fx-neg' : ''}>{money(total)}</b></span>
      </button>
      {open && (
        <div className="pco-accpop" role="dialog" aria-label={t('pco.accounts')}>
          <h4>{t('pco.accounts')}</h4>
          {rows.length === 0 && <p className="fx-muted">{t('pco.noAccounts')}</p>}
          {rows.map(({ a, bal }) => (
            <div key={a.id} className={'pco-acc ' + a.type}>
              <span className="pco-acc-dot" />
              <span className="pco-acc-main"><b>{a.name}</b><small>{t('pco.accType_' + a.type)}</small></span>
              <b className={a.type === 'debt' || bal < 0 ? 'fx-neg' : ''}>{money(bal)}</b>
            </div>
          ))}
          <Link to="/contas" className="mv-link pco-accall">{t('blk.seeAll')}</Link>
        </div>
      )}
    </div>
  );
}

export function PcOverview() {
  const { t } = useTranslation();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const now = new Date();
  const [per, setPer] = useState<Period>(() => initialPeriod(now));
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [cells, setCells] = useState<Cell[]>(loadLayout);
  const plans = usePlans();
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => { db.transactions.toArray().then((r) => setTxs(r.filter((x) => x.deletedAt === null))).catch(() => {}); }, []);

  const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const sumRange = (r: { from: string; to: string }) => {
    let inc = 0, exp = 0, n = 0;
    for (const x of txs) if (x.date >= r.from && x.date <= r.to) { n++; if (x.type === 'income') inc += x.amountCents; else exp += x.amountCents; }
    return { inc, exp, n };
  };
  const yearly = per.mode === 'year', ranged = per.mode === 'range';
  const range = periodRange(per);
  const a = sumRange(range), p = sumRange(previousRange(per));
  const left = a.inc - a.exp, prevLeft = p.inc - p.exp;
  const delta = (n: number, b: number) => (b === 0 ? null : (n - b) / Math.abs(b));
  const isNowMonth = per.mode === 'month' && per.y === now.getFullYear() && per.m === now.getMonth();
  const todayIso = key(now.getFullYear(), now.getMonth()) + '-' + String(now.getDate()).padStart(2, '0');
  const spanEnd = range.to > todayIso ? todayIso : range.to;
  const days = Math.max(1, Math.round((new Date(spanEnd + 'T00:00:00').getTime() - new Date(range.from + 'T00:00:00').getTime()) / 864e5) + 1);
  const months = yearly ? (per.y === now.getFullYear() ? now.getMonth() + 1 : 12) : Math.max(1, Math.round(days / 30.4));
  const prevName = yearly ? String(per.y - 1) : ranged ? t('pco.prev_' + per.preset) : new Date(per.y, per.m - 1, 1).toLocaleDateString(s.language, { month: 'long' });

  // gráfico: os 12 meses do ano do período
  const endY = Number(range.to.slice(0, 4)), endM = Number(range.to.slice(5, 7)) - 1;
  const chartY = yearly ? per.y : endY;
  const series = Array.from({ length: 12 }, (_, i) => {
    const v = sumRange({ from: key(chartY, i) + '-01', to: key(chartY, i) + '-31' });
    const mName = new Date(chartY, i, 1).toLocaleDateString(s.language, { month: 'short' }).replace('.', '');
    return { label: mName, tick: mName, earning: v.inc, spending: v.exp };
  });
  const upTo = chartY < now.getFullYear() ? 11 : chartY === now.getFullYear() ? now.getMonth() : 0;
  const ratio = (x: number) => (a.inc > 0 ? x / a.inc : 0);
  const long = yearly || ranged;
  const avg = (v: number) => (long ? t('pco.avgMonth', { v: money(Math.round(v / months)) }) : t('pco.avgDay', { v: money(Math.round(v / days)) }));
  const vm = yearly ? 'year' : ranged ? 'range' : 'month';
  const em = { y: ranged ? endY : per.y, m: ranged ? endM : per.m };
  const multiMonth = yearly || (ranged && range.from.slice(0, 7) !== range.to.slice(0, 7));
  const ek = vm + range.from + range.to;

  const blocks: Record<WidgetId, JSX.Element> = {
    chart: (
      <section className="mv-card pco-chart">
        <div className="pco-mhead"><span className="pco-mic"><Ic d={IC.chart} size={18} /></span><h3>{t('pco.incomeAnalysis')}</h3>
          <span className="pco-legend"><i className="inc" />{t('pco.income')} <i className="exp" />{t('pco.expenses')}</span></div>
        <OverviewChart series={series} upTo={upTo} money={money} t={t} />
      </section>
    ),
    metrics: (
      <div className="pco-metrics">
        <Metric icon={IC.income} tone="inc" title={t('pco.inc_' + vm)} value={money(a.inc)} valueClass="fx-pos"
          delta={delta(a.inc, p.inc)} deltaGoodUp prevName={prevName} vsLabel={t('pco.vs')} bar={a.inc > 0 ? 1 : 0} sub={long ? avg(a.inc) : undefined} />
        <Metric icon={IC.spent} tone="exp" title={t('pco.spent_' + vm)} value={money(a.exp)} valueClass={a.exp > 0 ? 'fx-neg' : ''}
          delta={delta(a.exp, p.exp)} deltaGoodUp={false} prevName={prevName} vsLabel={t('pco.vs')} bar={ratio(a.exp)} sub={avg(a.exp)} />
        <Metric icon={IC.saved} tone="sav" title={isNowMonth ? t('pco.leftMonth') : t('pco.saved_' + vm)} value={money(left)} valueClass={left < 0 ? 'fx-neg' : 'fx-pos'}
          delta={delta(left, prevLeft)} deltaGoodUp prevName={prevName} vsLabel={t('pco.vs')} bar={ratio(Math.max(0, left))} sub={long ? avg(left) : undefined} />
      </div>
    ),
    latest: <SimpleHome key={'l' + ek} embed={{ mode: yearly ? 'year' : 'month', ...em, part: 'latest', range, seeAll: ranged ? `/transacoes?de=${range.from}&ate=${range.to}&p=${per.preset}` : yearly ? `/transacoes?ano=${per.y}` : `/transacoes?mes=${key(per.y, per.m)}` }} />,
    cats: <SimpleOverview key={'c' + ek} yearly={multiMonth} embed={{ ...em, part: 'cats', range: ranged ? range : undefined }} />,
    cal: <SimpleOverview key={'k' + ek} yearly={multiMonth} embed={{ ...em, part: 'cal' }} />,
    goals: <SimpleHome key="g" embed={{ mode: 'month', y: now.getFullYear(), m: now.getMonth(), part: 'goals' }} />,
    groups: <SimpleHome key="gr" embed={{ mode: 'month', y: now.getFullYear(), m: now.getMonth(), part: 'groups' }} />,
    limits: <LimitsWidget money={money} y={em.y} m={em.m} />,
    accounts: <AccountsWidget money={money} />,
    assistant: <AssistantWidget />,
    plans: <PlansWidget rows={plans ?? []} money={money} />,
  };

  const save = (next: Cell[]) => { setCells(next); try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* sem storage */ } };
  const reset = () => { setCells(fromOrder(DEFAULT_ORDER)); try { localStorage.removeItem(LAYOUT_KEY); localStorage.removeItem(ORDER_KEY); } catch { /* sem storage */ } };
  const has = (id: string) => cells.some((c) => c.id === id);
  const hidden = ALL_WIDGETS.filter((w) => w !== 'plans' && !has(w));
  const planOf = (id: string) => (plans ?? []).find((r) => 'plan:' + r.a.id === id);
  const nameOf = (id: string) => planOf(id)?.a.name ?? L(WNAME[id as WidgetId] ?? 'Conta');
  const addW = (id: string, h?: number) => { save(addCell(cells, id, 8, h)); setAddOpen(false); };

  return (
    <div className="fx-page pco">
      <header className="pco-head">
        <div className="pco-title">
          <PeriodFilter value={per} onChange={setPer} />
        </div>
        <div className="pco-right">
          {editing && <>
            <div className="pco-addw">
              <button type="button" className="pf-chip on" onClick={() => setAddOpen(!addOpen)}>+ {L('Adicionar widget')}</button>
              {addOpen && <div className="pf-menu pco-addmenu" role="menu">
                {hidden.map((w) => <button key={w} type="button" role="menuitem" onClick={() => addW(w)}>{L(WNAME[w])}</button>)}
                <div className="pco-addsub"><button type="button" role="menuitem" disabled={has('plans')} onClick={() => addW('plans')}>{L('Poupanças e dívidas')} <small>{has('plans') ? L('já está no Resumo') : L('todas')}</small></button>
                  {(plans ?? []).map(({ a }) => <button key={a.id} type="button" role="menuitem" className="sub" disabled={has('plan:' + a.id)} onClick={() => addW('plan:' + a.id, 9)}>{a.name} <small>{has('plan:' + a.id) ? L('já está no Resumo') : a.type === 'debt' ? L('Dívida') : L('Poupança')}</small></button>)}</div>
              </div>}
            </div>
            <button type="button" className="pf-chip" onClick={reset}>{t('pco.reset')}</button>
            <button type="button" className="pf-chip on" onClick={() => { setEditing(false); setAddOpen(false); }}>{t('pco.done')}</button>
          </>}
          {!editing && <button type="button" className="pco-sq" onClick={() => setEditing(true)} aria-label={t('pco.customize')} title={t('pco.customize')}><Ic d={SLIDERS} size={19} /></button>}
          <AccountsChip money={money} />
          <AccountBar />
        </div>
      </header>
      {editing && <p className="pco-hint">{t('pco.dragHint')}</p>}

      <FreeGrid cells={cells} editing={editing} names={nameOf} render={(id) => (id.startsWith('plan:') ? plans && <PlanWidget row={planOf(id)} money={money} /> : blocks[id as WidgetId])} onChange={save} onRemove={(id) => save(cells.filter((c) => c.id !== id))} />
    </div>
  );
}
