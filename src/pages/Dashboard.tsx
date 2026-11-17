import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import type { AppSettings } from '../core/settings';
import type { Transaction, Budget, Category, Salary } from '../db/database';
import { categoryImage } from '../core/category-images';

// ── Pure helpers (integer cents only, no float money) ────────────────────────
function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Month-over-month change in cents; null when the previous month has no data.
function changePct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}



// ── Card shell ────────────────────────────────────────────────────────────────
function GlassCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative rounded-2xl border border-white/10 backdrop-blur-xl bg-white/5
        shadow-[0_28px_70px_-28px_rgba(0,0,0,0.85),0_10px_30px_-14px_rgba(139,92,246,0.35)] ${className}`}
    >
      <div className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))' }} />
      <div className="relative">
        {children}
      </div>
    </div>
  );
}

function CardTitle({ title, sub, icon }: { title: string; sub?: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {icon && (
          <span className="w-[34px] h-[34px] rounded-xl border border-white/10 bg-white/7 grid place-items-center text-sm">
            {icon}
          </span>
        )}
        <h3 className="text-sm font-semibold text-white/90 tracking-wide">{title}</h3>
      </div>
      {sub && <span className="text-xs text-white/50">{sub}</span>}
    </div>
  );
}



// ── Income Analysis: bar chart (Despesas/Salário/Extras, Excel-style) or category pie ─
function IncomeChart({ monthly, catTotals, settings, mode }: {
  monthly: { label: string; expense: number; salary: number; extras: number }[];
  catTotals: { name: string; totalCents: number }[];
  settings: AppSettings;
  mode: 'bars' | 'pie';
}) {
  const money = (v: number) => formatMoney(v, settings.currency, settings.language);
  if (mode === 'pie') {
    const data = catTotals.length
      ? catTotals.map((c) => ({ name: c.name, value: c.totalCents }))
      : [{ name: 'empty', value: 1 }];
    const palette = ['#22d3ee', '#f472b6', '#60a5fa', '#f59e0b', '#8b5cf6', '#34d399', '#e11d48', '#94a3b8', '#a78bfa', '#fbbf24'];
    return (
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95}
              stroke="rgba(255,255,255,0.15)" strokeWidth={1}>
              {data.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
            </Pie>
            <Tooltip cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const total = data.reduce((s, d) => s + d.value, 0);
                const v = Number(payload[0].value) || 0;
                return (
                  <div className="rounded-xl border border-white/10 bg-white/10 backdrop-blur-xl px-3 py-2 shadow-xl">
                    <div className="text-xs text-white/50">{payload[0].name}</div>
                    <div className="text-lg font-bold text-white">{money(v)}</div>
                    <div className="text-xs text-[#a78bfa]">{total > 0 ? Math.round((v / total) * 100) : 0}%</div>
                  </div>
                );
              }} />
            <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false}
            tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} width={56}
            tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }}
            tickFormatter={(v) => money(v)} />
          <Tooltip cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              return (
                <div className="rounded-xl border border-white/10 bg-white/10 backdrop-blur-xl px-3 py-2 shadow-xl">
                  <div className="text-xs text-white/50">{payload[0].payload.label}</div>
                  {payload.map((p) => (
                    <div key={String(p.name)} className="text-xs text-white/80">{p.name}: {money(Number(p.value) || 0)}</div>
                  ))}
                </div>
              );
            }} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }} />
          <Bar dataKey="expense" name="Despesas" fill="#22d3ee" radius={[3, 3, 0, 0]} />
          <Bar dataKey="salary" name="Salário" fill="#34d399" radius={[3, 3, 0, 0]} />
          <Bar dataKey="extras" name="Extras" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── ALTURA progress bar (CSS/SVG layers: gradient fill + end reflection + dash track) ─
const BAR_GRADS = {
  blue: {
    // deep petrol -> blue -> luminous cyan (sampled from reference)
    grad: 'linear-gradient(90deg,#14386b 0%,#2b6f9e 55%,#4fd1c5 92%,#a5f3fc 100%)',
    glow: '#67e8f9',
  },
  purple: {
    // dark purple -> violet/magenta -> luminous lilac
    grad: 'linear-gradient(90deg,#3b1f5b 0%,#8b5cf6 55%,#c084fc 92%,#e6c8ff 100%)',
    glow: '#d8a8ff',
  },
};

function AltBar({ value, max, variant, name }: {
  value: number; max: number;
  variant: 'blue' | 'purple'; name: string;
}) {
  const p = max > 0 ? clamp(Math.round((value / max) * 100), 0, 100) : 0; // real data; no invented progress
  const g = BAR_GRADS[variant];
  return (
    <div className="alt-bar" role="progressbar" aria-label={name}
      aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      {/* unfilled remainder: thin ~1px dashes, 4px apart, shorter than fill, centered */}
      <div className="alt-bar-track" aria-hidden="true">
        <div className="alt-bar-dashes" style={{ ['--dash-color' as any]: g.glow }} />
      </div>
      {/* continuous gradient fill with discreet outer glow + narrow reflection at right end */}
      <div className="alt-bar-fill" style={{ width: `${p}%`, background: g.grad, ['--bar-glow' as any]: g.glow }}>
        <span className="alt-bar-reflection" aria-hidden="true" />
      </div>
    </div>
  );
}

function ProgressCard({ title, value, total, percent, changePct, tone, icon }: {
  title: string;
  value: number;
  total: number;
  percent: number;
  changePct: number | null;
  tone: 'blue' | 'magenta';
  icon?: ReactNode;
}) {
  const variant = tone === 'blue' ? 'blue' : 'purple';
  const up = changePct !== null && changePct >= 0;
  return (
    <GlassCard className="p-5">
      <CardTitle title={title} icon={icon} />
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-bold leading-tight text-white">{formatMoney(value, 'EUR', 'en')}</div>
          <div className="text-xs text-white/50 mt-1">{formatMoney(total, 'EUR', 'en')} total</div>
        </div>
        {changePct !== null && (
          <div className={`text-sm font-semibold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
            {up ? '▲' : '▼'} {Math.abs(changePct)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <AltBar value={value} max={total} variant={variant} name={title} />
      </div>
      <div className="mt-2 text-xs text-white/45">{percent}% of income</div>
    </GlassCard>
  );
}

// ── Donut for budget usage ────────────────────────────────────────────────────
function Donut({ used, budget }: { used: number; budget: number }) {
  const over = budget > 0 && used > budget;
  const frac = budget > 0 ? clamp(used / budget, 0, 1) : 0;
  const color = over ? '#f43f5e' : frac > 0.85 ? '#f59e0b' : '#22c55e';
  const empty = budget <= 0;
  const data = empty
    ? [{ name: 'empty', value: 1 }]
    : [
        { name: 'used', value: used },
        { name: 'left', value: Math.max(budget - used, 0) },
      ];
  return (
    <div className="relative" style={{ width: 120, height: 120 }}>
      <PieChart width={120} height={120}>
        <Pie
          data={data}
          cx={60}
          cy={60}
          innerRadius={42}
          outerRadius={54}
          startAngle={90}
          endAngle={-270}
          stroke="none"
        >
          {empty ? (
            <Cell fill="rgba(255,255,255,0.12)" />
          ) : (
            <>
              <Cell fill={color} />
              <Cell fill="rgba(255,255,255,0.08)" />
            </>
          )}
        </Pie>
      </PieChart>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span style={{ color: 'white', fontSize: 22, fontWeight: 700 }}>{budget > 0 ? Math.round((used / budget) * 100) : 0}</span>
      </div>
    </div>
  );
}

// ── Daily Spend calendar ──────────────────────────────────────────────────────
function DailySpendCalendar({ monthTx, settings, t }: {
  monthTx: Transaction[];
  settings: AppSettings;
  t: (k: string) => string;
}) {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const spend = new Array(daysInMonth + 1).fill(0);
  for (const tx of monthTx) {
    if (tx.type !== 'expense') continue;
    const day = parseInt(tx.date.slice(8, 10), 10);
    if (day >= 1 && day <= daysInMonth) spend[day] += tx.amountCents;
  }
  const maxDay = Math.max(1, ...spend);
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString(settings.language, { month: 'long', year: 'numeric' });

  const monthTotal = spend.reduce((a, b) => a + b, 0);

  const cellColor = (v: number) => {
    if (v === 0) return 'rgba(255,255,255,0.05)';
    const intensity = clamp(v / maxDay, 0.15, 1);
    return `rgba(139,92,246,${0.18 + intensity * 0.6})`;
  };

  const prev = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const next = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prev} aria-label={t('panel.prevMonth')}
          className="rounded-xl border border-white/10 bg-white/5 backdrop-blur px-3 py-2 text-white/80 hover:bg-white/10 transition">
          ‹
        </button>
        <div className="text-center">
          <h3 className="text-sm font-semibold text-white/90">{t('panel.dailySpend')}</h3>
          <div className="text-xs text-white/50">{monthLabel}</div>
        </div>
        <button onClick={next} aria-label={t('panel.nextMonth')}
          className="rounded-xl border border-white/10 bg-white/5 backdrop-blur px-3 py-2 text-white/80 hover:bg-white/10 transition">
          ›
        </button>
      </div>
      <div className="cal-grid grid grid-cols-7 gap-1">
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const v = spend[day];
          return (
            <div key={day}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/dia/${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  navigate(`/dia/${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
                }
              }}
              className="cal-cell rounded-lg border border-white/10 backdrop-blur text-center overflow-hidden transition cursor-pointer hover:border-violet-400/40"
              style={{ background: cellColor(v), boxShadow: v > 0 ? '0 6px 16px -8px rgba(139,92,246,0.55)' : 'none' }}>
              <div className="text-[10px] text-white/55">{day}</div>
              <div className="text-[10px] font-semibold text-white/90 truncate">
                {formatMoney(v, settings.currency, settings.language)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-white/50">
        <span>{t('panel.totalSpent') || 'Total'}</span>
        <span className="text-white/80 font-semibold">{formatMoney(monthTotal, settings.currency, settings.language)}</span>
      </div>
    </GlassCard>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export function Dashboard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [salaries, setSalaries] = useState<Salary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'bars' | 'pie'>('bars');
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [filterCat, setFilterCat] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [allTx, allB, allC, allS] = await Promise.all([
          db.transactions.toArray(),
          db.budgets.toArray(),
          db.categories.toArray(),
          db.salaries.toArray(),
        ]);
        if (!alive) return;
        setTxs(allTx.filter((x) => !x.deletedAt));
        setBudgets(allB.filter((x) => !x.deletedAt));
        setCats(allC.filter((x) => !x.deletedAt));
        setSalaries(allS.filter((x) => !x.deletedAt));
        setSettings(loadSettings());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="text-white/60 text-sm">{t('panel.loading')}</div>;
  }
  if (error) {
    return <div className="text-white/60 text-sm">{error}</div>;
  }

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthTx = txs.filter((tx) => tx.date.startsWith(curMonth));

  // Filtered transactions for the selected period/category (Excel-style filters)
  const inPeriod = (tx: Transaction) => {
    if (filterCat && tx.categoryId !== filterCat) return false;
    if (period === 'month') return tx.date.startsWith(curMonth);
    return tx.date.startsWith(String(now.getFullYear()));
  };

  // Monthly bars for the bar chart: expenses / salary / extras per month of the year
  const monthlyBars: { label: string; expense: number; salary: number; extras: number }[] = [];
  for (let m = 0; m < 12; m++) {
    const key = `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`;
    let exp = 0, extra = 0;
    for (const tx of txs) {
      if (!tx.date.startsWith(key)) continue;
      if (filterCat && tx.categoryId !== filterCat) continue;
      if (tx.type === 'expense') exp += tx.amountCents;
      else extra += tx.amountCents;
    }
    const sal = salaries.find((s) => s.year === now.getFullYear() && s.month === m + 1);
    monthlyBars.push({
      label: new Date(now.getFullYear(), m, 1).toLocaleString(settings.language, { month: 'short' }),
      expense: exp,
      salary: sal ? sal.amountCents : 0,
      extras: extra,
    });
  }

  // Category totals for the pie (respecting period + category filter)
  const filteredTx = txs.filter(inPeriod);
  const catTotals: { name: string; totalCents: number }[] = [];
  for (const tx of filteredTx) {
    if (tx.type !== 'expense') continue;
    const c = cats.find((x) => x.id === tx.categoryId);
    const name = c?.name ?? '—';
    const found = catTotals.find((x) => x.name === name);
    if (found) found.totalCents += tx.amountCents;
    else catTotals.push({ name, totalCents: tx.amountCents });
  }
  catTotals.sort((a, b) => b.totalCents - a.totalCents);

  // Prev month for the vs-last-month deltas (unchanged logic)
  const prevKey = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const prevTx = txs.filter((tx) => tx.date.startsWith(prevKey));
  const prevIncome = prevTx.filter((tx) => tx.type === 'income').reduce((a, tx) => a + tx.amountCents, 0);
  const prevExpense = prevTx.filter((tx) => tx.type === 'expense').reduce((a, tx) => a + tx.amountCents, 0);
  const prevSavings = prevIncome - prevExpense;

  const monthIncome = monthTx.filter((tx) => tx.type === 'income').reduce((a, tx) => a + tx.amountCents, 0);
  const monthExpense = monthTx.filter((tx) => tx.type === 'expense').reduce((a, tx) => a + tx.amountCents, 0);
  const savings = monthIncome - monthExpense;

  // Excel-style summary strip (Resumo sheet): totals for the selected period
  const periodTx = txs.filter(inPeriod);
  const totalSpent = periodTx.filter((tx) => tx.type === 'expense').reduce((a, tx) => a + tx.amountCents, 0);
  const salaryInPeriod = salaries
    .filter((s) => s.year === now.getFullYear())
    .reduce((a, s) => a + s.amountCents, 0);
  const extrasInPeriod = periodTx.filter((tx) => tx.type === 'income').reduce((a, tx) => a + tx.amountCents, 0);
  const incomeInPeriod = salaryInPeriod + extrasInPeriod;
  const savedPct = incomeInPeriod > 0 ? Math.round(((incomeInPeriod - totalSpent) / incomeInPeriod) * 100) : 0;
  const spentPct = incomeInPeriod > 0 ? Math.round((totalSpent / incomeInPeriod) * 100) : 0;
  const monthsWithData = new Set(periodTx.map((tx) => tx.date.slice(0, 7))).size || 1;
  const avgMonthlySavings = Math.round((incomeInPeriod - totalSpent) / monthsWithData);
  const savingsPct = pct(Math.max(0, savings), monthIncome);
  const expensePct = pct(monthExpense, monthIncome);

  // Budget usage
  let budgetTotal = 0, budgetUsed = 0;
  for (const b of budgets) {
    const used = monthTx.filter((tx) => tx.type === 'expense' && tx.categoryId === b.categoryId)
      .reduce((a, tx) => a + tx.amountCents, 0);
    budgetTotal += b.limitCents;
    budgetUsed += used;
  }

  const catById = (id: string) => cats.find((c) => c.id === id);
  const catName = (id: string) => catById(id)?.name ?? '—';

  const recent = [...monthTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return (
    <div className="min-h-screen bg-[#05060a] text-white"
      style={{ background: 'radial-gradient(900px 500px at 15% -10%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(800px 450px at 85% 110%, rgba(236,72,153,0.14), transparent 60%), #05060a' }}>
      <div className="dash-shell w-full mx-auto p-4 flex flex-col min-h-0">
        <div className="summary-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
          {[
            { label: t('panel.totalSpent'), value: formatMoney(totalSpent, settings.currency, settings.language) },
            { label: t('panel.dailyAverage'), value: formatMoney(Math.round(totalSpent / (period === 'month' ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : 365)), settings.currency, settings.language) },
            { label: t('panel.percentSpent'), value: `${spentPct}%` },
            { label: t('panel.percentSavings'), value: `${savedPct}%` },
            { label: t('panel.savingsPerMonth'), value: formatMoney(avgMonthlySavings, settings.currency, settings.language) },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-white/10 bg-white/5 backdrop-blur px-3 py-2">
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{m.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Top row: Income analysis (left) + savings/expenses (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 flex-1 min-h-[260px]">
          <GlassCard className="lg:col-span-2 p-4 flex flex-col">
            <CardTitle title={t('panel.incomeAnalysis')} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 14l4-6 4 4 5-7"/></svg>} />
            <div className="flex items-center justify-between gap-3 mt-3 text-xs text-white/70 flex-wrap">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setChartMode('bars')} aria-label={t('panel.monthly')}
                  className={`rounded-lg border border-white/10 px-3 py-1 transition ${chartMode === 'bars' ? 'bg-violet-500/25 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                  {t('panel.monthly')}
                </button>
                <button onClick={() => setChartMode('pie')} aria-label={t('panel.byCategory')}
                  className={`rounded-lg border border-white/10 px-3 py-1 transition ${chartMode === 'pie' ? 'bg-violet-500/25 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                  {t('panel.byCategory')}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setPeriod('month')}
                  className={`rounded-lg border border-white/10 px-3 py-1 transition ${period === 'month' ? 'bg-violet-500/25 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                  {t('panel.periodMonth')}
                </button>
                <button onClick={() => setPeriod('year')}
                  className={`rounded-lg border border-white/10 px-3 py-1 transition ${period === 'year' ? 'bg-violet-500/25 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                  {t('panel.periodYear')}
                </button>
                <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                  aria-label={t('panel.category')}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white/80">
                  <option value="">{t('panel.allCategories')}</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-2 flex-1 min-h-[170px]">
              <IncomeChart monthly={monthlyBars} catTotals={catTotals} settings={settings} mode={chartMode} />
            </div>
          </GlassCard>

          <div className="grid grid-cols-1 gap-2">
            <ProgressCard title={t('panel.monthlySavings')} value={savings} total={monthIncome} percent={savingsPct} changePct={changePct(savings, prevSavings)} tone="blue" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v20"/><path d="M17 6.5A7 7 0 0 0 5 12a7 7 0 0 0 14 5.5"/></svg>} />
            <ProgressCard title={t('panel.monthlyExpenses')} value={monthExpense} total={monthIncome} percent={expensePct} changePct={changePct(monthExpense, prevExpense)} tone="magenta" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>} />
          </div>
        </div>

        {/* Bottom row: recent (left) + budget (center) + calendar (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mt-2 flex-1 min-h-[240px]">
          <GlassCard className="p-4">
            <CardTitle title={t('panel.recentTransactions')} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>} />
            <ul className="mt-4 space-y-2">
              {recent.length === 0 && <li className="text-sm text-white/50">{t('panel.noData')}</li>}
              {recent.map((tx) => (
                <li key={tx.id} className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                  <img src={categoryImage(catById(tx.categoryId) ?? { name: catName(tx.categoryId) })}
                    alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm text-white/90">{tx.description || catName(tx.categoryId)}</div>
                    <div className="text-xs text-white/50">{tx.date}</div>
                  </div>
                  <div className={`text-sm font-semibold ${tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {tx.type === 'income' ? '+' : '-'}{formatMoney(tx.amountCents, settings.currency, settings.language)}
                  </div>
                </li>
              ))}
            </ul>
          </GlassCard>

          <GlassCard className="p-4">
            <CardTitle title={t('panel.budgetUsage')} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M12 3v9l6.4 6.4"/></svg>} />
            <div className="mt-3 flex items-center justify-center">
              <Donut used={budgetUsed} budget={budgetTotal} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-white/50">
              <span>{formatMoney(budgetUsed, settings.currency, settings.language)}</span>
              <span>{formatMoney(budgetTotal, settings.currency, settings.language)}</span>
            </div>
          </GlassCard>

          <DailySpendCalendar monthTx={monthTx} settings={settings} t={t} />
        </div>
      </div>
    </div>
  );
}
