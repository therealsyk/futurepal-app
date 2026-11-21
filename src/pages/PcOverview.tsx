// Resumo do PC: Mensal | Anual | Período, caixas de rendimento/gastos/poupança, gráfico, contas,
// últimos movimentos do período, categorias e calendário. Os blocos podem ser trocados de sítio (Personalizar).
import { useEffect, useState, type DragEvent, type JSX } from 'react';
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

const IC = {
  income: 'M12 19V5M5 12l7-7 7 7',
  spent: 'M12 5v14M5 12l7 7 7-7',
  saved: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wallet: 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
};

export function Metric({ icon, tone, title, value, valueClass, delta, deltaGoodUp, prevName, vsLabel, sub, bar }: {
  icon: string; tone: 'inc' | 'exp' | 'sav'; title: string; value: string; valueClass?: string;
  delta: number | null; deltaGoodUp: boolean; prevName: string; vsLabel: string; sub?: string; bar: number;
}) {
  const pct = delta === null ? null : Math.round(delta * 100);
  const good = pct === null || pct === 0 ? null : (pct > 0) === deltaGoodUp;
  return (
    <section className={'mv-card pco-metric ' + tone}>
      <div className="pco-mhead">
        <span className="pco-mic"><Ic d={icon} size={18} /></span>
        <h3>{title}</h3>
        {pct !== null && <span className={'pco-delta ' + (good === null ? 'same' : good ? 'good' : 'bad')}>{pct > 0 ? '+' : ''}{pct}% <small>{vsLabel} {prevName}</small></span>}
      </div>
      <strong className={'pco-value ' + (valueClass ?? '')}>{value}</strong>
      <small className="pco-sub">{sub || ' '}</small>
      <div className="pco-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, bar * 100))}%` }} /></div>
    </section>
  );
}

type WidgetId = 'chart' | 'metrics' | 'accounts' | 'latest' | 'cats' | 'cal';
const DEFAULT_ORDER: WidgetId[] = ['chart', 'metrics', 'accounts', 'latest', 'cats', 'cal'];
const ORDER_KEY = 'wallet.pcoOrder.v1';
function loadOrder(): WidgetId[] {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null') as WidgetId[] | null;
    if (Array.isArray(v) && v.length === DEFAULT_ORDER.length && DEFAULT_ORDER.every((x) => v.includes(x))) return v;
  } catch { /* sem storage */ }
  return DEFAULT_ORDER;
}

function AccountsWidget({ money }: { money: (c: number) => string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<{ a: Account; bal: number }>>([]);
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
  const total = rows.filter((r) => r.a.type !== 'debt').reduce((s, r) => s + r.bal, 0);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.bal)));
  return (
    <section className="mv-card pco-accts">
      <div className="pco-mhead"><span className="pco-mic"><Ic d={IC.wallet} size={18} /></span><h3>{t('pco.accounts')}</h3><Link to="/contas" className="mv-link">{t('blk.seeAll')}</Link></div>
      <div className="pco-acc-total"><small>{t('pco.totalAccounts')}</small><strong className={total < 0 ? 'fx-neg' : ''}>{money(total)}</strong></div>
      <div className="pco-acc-list">
        {rows.length === 0 && <p className="fx-muted">{t('pco.noAccounts')}</p>}
        {rows.map(({ a, bal }) => (
          <div key={a.id} className={'pco-acc ' + a.type}>
            <span className="pco-acc-dot" />
            <span className="pco-acc-main"><b>{a.name}</b><small>{t('pco.accType_' + a.type)}</small></span>
            <b className={a.type === 'debt' || bal < 0 ? 'fx-neg' : ''}>{money(bal)}</b>
            <i className="pco-acc-bar" style={{ width: `${Math.max(3, (Math.abs(bal) / max) * 100)}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function PcOverview() {
  const { t } = useTranslation();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const now = new Date();
  const [per, setPer] = useState<Period>(() => initialPeriod(now));
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [order, setOrder] = useState<WidgetId[]>(loadOrder);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<WidgetId | null>(null);
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
  const prevName = yearly ? String(per.y - 1) : ranged ? t('pco.prevPeriod') : new Date(per.y, per.m - 1, 1).toLocaleDateString(s.language, { month: 'long' });

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
          delta={delta(a.inc, p.inc)} deltaGoodUp prevName={prevName} vsLabel={t('pco.vs')} bar={a.inc > 0 ? 1 : 0}
          sub={t('pco.txCount', { count: a.n })} />
        <Metric icon={IC.spent} tone="exp" title={t('pco.spent_' + vm)} value={money(a.exp)} valueClass={a.exp > 0 ? 'fx-neg' : ''}
          delta={delta(a.exp, p.exp)} deltaGoodUp={false} prevName={prevName} vsLabel={t('pco.vs')} bar={ratio(a.exp)} sub={avg(a.exp)} />
        <Metric icon={IC.saved} tone="sav" title={isNowMonth ? t('pco.leftMonth') : t('pco.saved_' + vm)} value={money(left)} valueClass={left < 0 ? 'fx-neg' : 'fx-pos'}
          delta={delta(left, prevLeft)} deltaGoodUp prevName={prevName} vsLabel={t('pco.vs')} bar={ratio(Math.max(0, left))} sub={avg(left)} />
      </div>
    ),
    accounts: <AccountsWidget money={money} />,
    latest: <SimpleHome key={'l' + ek} embed={{ mode: yearly ? 'year' : 'month', ...em, part: 'latest', range }} />,
    cats: <SimpleOverview key={'c' + ek} yearly={multiMonth} embed={{ ...em, part: 'cats', range: ranged ? range : undefined }} />,
    cal: <SimpleOverview key={'k' + ek} yearly={multiMonth} embed={{ ...em, part: 'cal' }} />,
  };

  const onDrop = (target: WidgetId) => (e: DragEvent) => {
    e.preventDefault();
    if (!drag || drag === target) return;
    const next = [...order]; const i = next.indexOf(drag), j = next.indexOf(target);
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next); setDrag(null);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* sem storage */ }
  };
  const reset = () => { setOrder(DEFAULT_ORDER); try { localStorage.removeItem(ORDER_KEY); } catch { /* sem storage */ } };

  return (
    <div className="fx-page pco">
      <header className="pco-head">
        <div className="pco-title">
          <PeriodFilter value={per} onChange={setPer} />
          <button type="button" className={'pf-chip' + (editing ? ' on' : '')} onClick={() => setEditing(!editing)}>{editing ? t('pco.done') : t('pco.customize')}</button>
          {editing && <button type="button" className="pf-chip" onClick={reset}>{t('pco.reset')}</button>}
        </div>
        <AccountBar />
      </header>
      {editing && <p className="pco-hint">{t('pco.dragHint')}</p>}

      <div className={'pco-grid' + (editing ? ' editing' : '')}>
        {order.map((id, i) => (
          <div key={id} className={`pco-slot s${i}` + (drag === id ? ' dragging' : '')} draggable={editing}
            onDragStart={() => setDrag(id)} onDragEnd={() => setDrag(null)} onDragOver={(e) => { if (editing) e.preventDefault(); }} onDrop={onDrop(id)}>
            {editing && <span className="pco-grip"><Ic d={IC.grip} size={18} /></span>}
            {blocks[id]}
          </div>
        ))}
      </div>
    </div>
  );
}
