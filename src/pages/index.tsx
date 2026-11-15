import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';

import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import type { AppSettings } from '../core/settings';
import type { Transaction, Budget } from '../db/database';
import { Transactions } from './Transactions';
import { Calendar } from './Calendar';
import { Salaries } from './Salaries';
import { Budgets } from './Budgets';
import { Goals } from './Goals';
import { LineChart } from '../ui/components';



const svgIcon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function PageTitle({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <h1 className="page-title">{t(titleKey)}</h1>;
}

type ChartMode = 'monthly' | 'yearly';

export function Panel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [mode, setMode] = useState<ChartMode>('monthly');
  const [catFilter, setCatFilter] = useState<string>('all');

  useEffect(() => {
    setSettings(loadSettings());
    db.transactions.toArray().then((rows) => setTxs(rows.filter((r) => r.deletedAt === null)));
    db.categories.toArray().then((rows) => setCats(rows.filter((r) => r.deletedAt === null).map((r) => ({ id: r.id, name: r.name }))));
    db.budgets.toArray().then((rows) => setBudgets(rows.filter((r) => r.deletedAt === null)));
  }, []);

  if (!settings) return <p className="muted">…</p>;

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.toISOString().slice(0, 7);
  })();

  const live = txs.filter((tx) => !isNaN(new Date(tx.date).getTime()));
  const monthTx = live.filter((tx) => tx.date.slice(0, 7) === thisMonth);
  const lastMonthTx = live.filter((tx) => tx.date.slice(0, 7) === lastMonth);

  const sum = (rows: Transaction[], type: 'income' | 'expense') =>
    rows.filter((tx) => tx.type === type).reduce((a, tx) => a + tx.amountCents, 0);

  const income = sum(monthTx, 'income');
  const spent = sum(monthTx, 'expense');
  const saved = income - spent;
  const lastIncome = sum(lastMonthTx, 'income');
  const lastSpent = sum(lastMonthTx, 'expense');
  const lastSaved = lastIncome - lastSpent;

  const pctDelta = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / Math.abs(prev)) * 100);
  };

  // ── Chart data ──
  const yearlyTotals: { month: string; income: number; expense: number }[] = [];
  for (const tx of live) {
    const m = tx.date.slice(0, 7);
    const row = yearlyTotals.find((r) => r.month === m) ?? { month: m, income: 0, expense: 0 };
    if (tx.type === 'income') row.income += tx.amountCents; else row.expense += tx.amountCents;
    if (!yearlyTotals.includes(row)) yearlyTotals.push(row);
  }
  const monthly = yearlyTotals.sort((a, b) => a.month.localeCompare(b.month));
  const yearlyMap: Record<string, { income: number; expense: number }> = {};
  for (const tx of live) {
    const y = tx.date.slice(0, 4);
    const row = yearlyMap[y] ?? { income: 0, expense: 0 };
    if (tx.type === 'income') row.income += tx.amountCents; else row.expense += tx.amountCents;
    yearlyMap[y] = row;
  }
  const years = Object.keys(yearlyMap).sort();

  const chartRows = mode === 'monthly'
    ? monthly.map((m) => ({ label: m.month.slice(5) + ' ' + m.month.slice(0, 4), income: m.income, expense: m.expense }))
    : years.map((y) => ({ label: y, income: yearlyMap[y].income, expense: yearlyMap[y].expense }));

  const filteredChart = catFilter === 'all'
    ? chartRows
    : (() => {
        const catIds = new Set(cats.filter((c) => c.name.toLowerCase() === catFilter).map((c) => c.id));
        const map: Record<string, { income: number; expense: number }> = {};
        for (const tx of live) {
          if (!catIds.has(tx.categoryId)) continue;
          const key = mode === 'monthly' ? tx.date.slice(0, 7) : tx.date.slice(0, 4);
          const row = map[key] ?? { income: 0, expense: 0 };
          if (tx.type === 'income') row.income += tx.amountCents; else row.expense += tx.amountCents;
          map[key] = row;
        }
        return Object.keys(map).sort().map((k) => ({
          label: mode === 'monthly' ? k.slice(5) + ' ' + k.slice(0, 4) : k,
          income: map[k].income,
          expense: map[k].expense,
        }));
      })();

  // ── Budget usage ──

  let budgetUsed = 0;
  for (const b of budgets) {
    const used = monthTx.filter((tx) => tx.type === 'expense' && tx.categoryId === b.categoryId).reduce((a, x) => a + x.amountCents, 0);
    budgetUsed += Math.min(used, b.limitCents);
  }
  const budgetTotal = budgets.reduce((a, b) => a + b.limitCents, 0);
  const budgetPct = budgetTotal > 0 ? Math.min(100, Math.round((budgetUsed / budgetTotal) * 100)) : 0;

  // ── Recent transactions (5 latest) ──
  const recent = [...monthTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? '—';

  // ── Calendar: per-day spend this month ──
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daySpend: number[] = new Array(daysInMonth).fill(0);
  for (const tx of monthTx) {
    if (tx.type !== 'expense') continue;
    const d = parseInt(tx.date.slice(8, 10), 10);
    if (d >= 1 && d <= daysInMonth) daySpend[d - 1] += tx.amountCents;
  }
  const maxDay = Math.max(1, ...daySpend);
  const savingsPct = income > 0 ? Math.min(100, Math.round((saved / income) * 100)) : 0;
  const expensePct = income > 0 ? Math.min(100, Math.round((spent / income) * 100)) : 0;

  return (
    <div className="dashboard dash-grid">
      {/* ── Left zone: Income Analysis on top, Recent + Budget side by side ── */}
      <section className="zone-left">
        <article className="glass-card card-analysis">
          <header className="card-head">
            <span className="icon-sq">{svgIcon("M20.84 4.61a5.5 5.5 0 0 0-7.79 0L12 5.67l-1.05-1.06a5.5 5.5 0 0 0-7.79 7.79l1.05 1.06L12 14.33l7.79-7.79a5.5 5.5 0 0 0 0-7.79z")}</span>
            <h2>{t('panel.incomeAnalysis')}</h2>
            <div className="chart-controls">
              <button className={`seg ${mode === 'monthly' ? 'active' : ''}`} onClick={() => setMode('monthly')}>
                {t('panel.monthly')}
              </button>
              <button className={`seg ${mode === 'yearly' ? 'active' : ''}`} onClick={() => setMode('yearly')}>
                {t('panel.yearly')}
              </button>
              <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="category filter">
                <option value="all">{t('panel.allCategories')}</option>
                {cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </header>
          {filteredChart.length === 0 ? (
            <p className="muted">{t('panel.noData')}</p>
          ) : (
            <LineChart
              rows={filteredChart}
              currency={settings.currency}
              language={settings.language}
              incomeLabel={t('panel.income')}
            />
          )}
        </article>

        <article className="glass-card card-recent">
          <header className="card-head">
            <span className="icon-sq">{svgIcon("M4 7h16 M4 12h16 M4 17h10")}</span>
            <h2>{t('panel.recentTransactions')}</h2>
            <a className="link" href="#transactions">{t('panel.seeAll')}</a>
          </header>
          {recent.length === 0 ? (
            <p className="muted">{t('panel.noData')}</p>
          ) : (
            <ul className="tx-list">
              {recent.map((tx) => (
                <li key={tx.id}>
                  <span className={`dot ${tx.type === 'income' ? 'green' : 'pink'}`} />
                  <div>
                    <strong>{tx.description || catName(tx.categoryId)}</strong>
                    <small>{tx.date} · {catName(tx.categoryId)}</small>
                  </div>
                  <span className={`amount ${tx.type === 'income' ? 'pos' : 'neg'}`}>
                    {tx.type === 'income' ? '+' : '−'}{formatMoney(tx.amountCents, settings.currency, settings.language)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="glass-card card-budget">
          <header className="card-head">
            <span className="icon-sq">{svgIcon("M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 6v12a2 2 0 0 0 2 2h16v-6")}</span>
            <h2>{t('panel.budgetUsage')}</h2>
          </header>
          <div className="donut-wrap">
            <svg viewBox="0 0 100 100" width="92" height="92" aria-hidden="true">
              <circle className="donut-track" cx="50" cy="50" r="40" />
              <circle className="donut-fill" cx="50" cy="50" r="40"
                strokeDasharray={`${budgetPct * 2.513} 251.3`} />
              <text className="donut-label" x="50" y="54" textAnchor="middle">{budgetPct}%</text>
            </svg>
          </div>
          <ul className="legend">
            <li><span className="dot green" />{t('panel.savedDonut')} — {100 - budgetPct}%</li>
            <li><span className="dot pink" />{t('panel.spendingDonut')} — {budgetPct}%</li>
            {budgets.slice(0, 4).map((b) => {
              const used = monthTx.filter((tx) => tx.type === 'expense' && tx.categoryId === b.categoryId).reduce((a, x) => a + x.amountCents, 0);
              return <li key={b.id}><span className="dot blue" />{catName(b.categoryId)} — {formatMoney(used, settings.currency, settings.language)} / {formatMoney(b.limitCents, settings.currency, settings.language)}</li>;
            })}
          </ul>
          <a className="link" href="#budgets">{t('panel.manageBudgets')}</a>
        </article>
      </section>

      {/* ── Right zone: Savings, Expenses and daily-spend calendar stacked ── */}
      <section className="zone-right">
        <article className="glass-card kpi kpi-savings">
          <header className="card-head"><span className="icon-sq">{svgIcon("M12 2v20 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6")}</span><h2>{t('panel.savings')}</h2></header>
          <div className="kpi-value">{formatMoney(saved, settings.currency, settings.language)}</div>
          <div className={`delta ${saved >= lastSaved ? 'up' : 'down'}`}>
            {pctDelta(saved, lastSaved)}% {t('panel.vsLastMonth')}
          </div>
          <div className="kpi-bar"><span className="kpi-bar-fill" style={{ width: savingsPct + '%' }} /></div>
        </article>

        <article className="glass-card kpi kpi-expenses">
          <header className="card-head"><span className="icon-sq">{svgIcon("M3 3v18h18 M7 14l4-4 3 3 5-6")}</span><h2>{t('panel.expenses')}</h2></header>
          <div className="kpi-value">{formatMoney(spent, settings.currency, settings.language)}</div>
          <div className={`delta ${spent <= lastSpent ? 'up' : 'down'}`}>
            {pctDelta(spent, lastSpent)}% {t('panel.vsLastMonth')}
          </div>
          <div className="kpi-bar"><span className="kpi-bar-fill" style={{ width: expensePct + '%' }} /></div>
        </article>


        {/* ── Calendar card (per-day spend) — stacked in the right zone ── */}
        <article className="glass-card card-calendar">
          <header className="card-head">
            <span className="icon-sq">{svgIcon("M8 2v4 M16 2v4 M3 5h18v14H3z M3 10h18")}</span>
            <h2>{t('panel.dailySpend')}</h2>
          </header>
          <div className="cal-grid">
            {daySpend.map((amt, i) => (
              <div key={i} className={`cal-day ${amt === 0 ? 'empty' : ''} ${(i + 1) === now.getDate() ? 'today' : ''}`} title={`${thisMonth}-${String(i + 1).padStart(2, '0')}`}>
              <span className="dnum">{i + 1}</span>
              <span className="damt" style={{ opacity: amt > 0 ? Math.max(0.35, amt / maxDay) : 0 }}>
                {amt > 0 ? formatMoney(amt, settings.currency, settings.language) : '·'}
              </span>
            </div>
          ))}
        </div>
      </article>
      </section>
    </div>
  );
}

export { Transactions, Calendar, Salaries, Budgets, Goals };
