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
import { periodKpis } from '../core/finance';

// ── Pure helpers (integer cents only, no float money) ────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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

// ── Mockup-style KPI cards (savings / expenses) ───────────────────────────────
function SavingsCard({ title, valueCents, perMonthCents, salaryCents, extrasCents, pctOfIncome, settings, t }: {
  title: string; valueCents: number; perMonthCents: number; salaryCents: number;
  extrasCents: number; pctOfIncome: number | null; settings: AppSettings; t: (k: string) => string;
}) {
  const money = (v: number) => formatMoney(v, settings.currency, settings.language);
  return (
    <div className="mock-card">
      <div className="mock-head">
        <span className="mock-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 14l4-6 4 4 5-7"/></svg></span>
        {title}
      </div>
      <div className="mock-big">{money(Math.max(0, valueCents))}</div>
      <div className="mock-meta mt-1">
        Salário: {money(salaryCents)} · Extras: {money(extrasCents)}
      </div>
      <div className="pill-bar mt-3">
        <div className="pill-fill blue" style={{ width: `${pctOfIncome === null ? 0 : clamp(pctOfIncome, 4, 100)}%` }} />
        <div className="tick-track" aria-hidden="true" />
      </div>
      <div className="mock-meta mt-2">
        {pctOfIncome !== null ? `${pctOfIncome}% ${t('panel.percentSpent')}` : t('panel.noBase')} · {t('panel.savingsPerMonth')}: {money(Math.max(0, perMonthCents))}
      </div>
    </div>
  );
}

function ExpensesCard({ title, valueCents, count, avgDailyCents, pctOfIncome, settings, t }: {
  title: string; valueCents: number; count: number; avgDailyCents: number;
  pctOfIncome: number | null; settings: AppSettings; t: (k: string) => string;
}) {
  const money = (v: number) => formatMoney(v, settings.currency, settings.language);
  return (
    <div className="mock-card">
      <div className="mock-head">
        <span className="mock-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 14l4-6 4 4 5-7"/></svg></span>
        {title}
      </div>
      <div className="mock-big">{money(valueCents)}</div>
      <div className="mock-meta mt-1">
        {count} despesas · {money(avgDailyCents)} média/dia
      </div>
      <div className="pill-bar mt-3">
        <div className="pill-fill purple" style={{ width: `${pctOfIncome === null ? 0 : clamp(pctOfIncome, 4, 100)}%` }} />
        <div className="tick-track" aria-hidden="true" />
      </div>
      <div className="mock-meta mt-2">{pctOfIncome !== null ? `${pctOfIncome}% ${t('panel.percentSpent')}` : t('panel.noBase')}</div>
    </div>
  );
}

// ── Category donut (SVG, no extra deps) ───────────────────────────────────────
function CategoryDonut({ catTotals, totalCents }: {
  catTotals: { name: string; totalCents: number }[]; totalCents: number;
}) {
  const palette = ['#22d3ee', '#f472b6', '#60a5fa', '#f59e0b', '#8b5cf6', '#34d399', '#e11d48', '#94a3b8', '#a78bfa', '#fbbf24'];
  if (totalCents <= 0 || catTotals.length === 0) {
    return <div className="mock-meta mt-2">—</div>;
  }
  const cx = 60, cy = 60, r = 46;
  let angle = -Math.PI / 2;
  const arcs = catTotals.map((c, i) => {
    const frac = c.totalCents / totalCents;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    return { d: `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`, fill: palette[i % palette.length], pct: Math.round(frac * 100), name: c.name };
  });
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="category breakdown">
        {arcs.map((a) => (
          <path key={a.name} d={a.d} fill={a.fill} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
        ))}
      </svg>
      <div style={{ display: 'grid', gap: 4, fontSize: 11.5 }}>
        {arcs.slice(0, 6).map((a) => (
          <div key={a.name} style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'rgba(255,255,255,0.75)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: a.fill, flex: 'none' }} />
            {a.name} · {a.pct}%
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Monthly breakdown table (Jan–Dez, mockup style) ───────────────────────────
function MonthlyTable({ rows, settings, t }: {
  rows: { label: string; expense: number; salary: number; extras: number }[];
  settings: AppSettings; t: (k: string) => string;
}) {
  const money = (v: number) => formatMoney(v, settings.currency, settings.language);
  const maxExp = Math.max(1, ...rows.map((r) => r.expense));
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {rows.map((r) => (
        <div key={r.label} className="mock-row">
          <span style={{ color: 'rgba(255,255,255,0.7)' }}>{r.label}</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((r.expense / maxExp) * 100)}%`, height: '100%', background: 'linear-gradient(90deg,#7a1fb8,#b14cf0)' }} />
          </div>
          <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{money(r.expense)}</span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>{money(Math.max(0, r.salary + r.extras - r.expense))} {t('panel.savedShort')}</span>
        </div>
      ))}
    </div>
  );
}

// ── Loan card (recurring transfer, mockup style) ──────────────────────────────
function LoanCard({ loan, settings, t }: {
  loan: { monthlyCents: number; pctOfSalary: number | null } | null;
  settings: AppSettings; t: (k: string) => string;
}) {
  const money = (v: number) => formatMoney(v, settings.currency, settings.language);
  if (!loan || loan.monthlyCents <= 0) {
    return (
      <div className="mock-card">
        <div className="mock-head">
          <span className="mock-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/></svg></span>
          {t('panel.loan') || 'Loan'}
        </div>
        <div className="mock-meta">{t('panel.noBase')}</div>
      </div>
    );
  }
  return (
    <div className="mock-card">
      <div className="mock-head">
        <span className="mock-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/></svg></span>
        {t('panel.loan') || 'Loan'}
      </div>
      <div className="mock-big">{money(loan.monthlyCents)}</div>
      <div className="mock-meta mt-1">
        {loan.pctOfSalary !== null ? `${loan.pctOfSalary}% do salário` : money(loan.monthlyCents) + ' / mês'}
      </div>
    </div>
  );
}

// ── AI tip card (mockup style, real data only) ────────────────────────────────
function AiTipCard({ savingsPct, missingMonths, topCategory, t }: {
  savingsPct: number | null; missingMonths: number; topCategory: string | null; t: (k: string) => string;
}) {
  const tips: string[] = [];
  if (missingMonths > 0) tips.push(`Faltam ${missingMonths} salário(s) registado(s) para calcular poupança.`);
  if (savingsPct !== null && savingsPct < 20) tips.push('Gasto acima de 80% do rendimento — revisiona categorias.');
  if (topCategory) tips.push(`Maior categoria: ${topCategory}.`);
  if (tips.length === 0) tips.push('Sem dados suficientes para recomendações.');
  return (
    <div className="mock-card">
      <div className="mock-head">
        <span className="mock-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3a7 7 0 0 1 4 12l-1 5h-6l-1-5A7 7 0 0 1 12 3z"/></svg></span>
        {t('panel.aiAssistant') || 'AI Assistant'}
      </div>
      <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.8)', display: 'grid', gap: 6 }}>
        {tips.map((tip) => <div key={tip}>{tip}</div>)}
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
              className="cal-cell border border-white/10 backdrop-blur text-center overflow-hidden transition cursor-pointer hover:border-violet-400/40"
              style={{ background: cellColor(v), boxShadow: v > 0 ? '0 6px 16px -8px rgba(139,92,246,0.55)' : 'none' }}>
              <div className="text-[11px] text-white/70">{day}</div>
              <div className="text-[11px] font-semibold text-white/90 truncate">
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

  const monthIncome = monthTx.filter((tx) => tx.type === 'income').reduce((a, tx) => a + tx.amountCents, 0);
  const monthExpense = monthTx.filter((tx) => tx.type === 'expense').reduce((a, tx) => a + tx.amountCents, 0);
  const savings = monthIncome - monthExpense;

  // Excel "Resumo" data for the selected period (used by KPI strip via periodKpis)
  const periodTx = txs.filter(inPeriod);

  // Excel "Resumo" KPIs for the selected period (pure helpers from core/finance)
  const kpis = periodKpis(periodTx, cats);

  // Income base for % spent/saved: salaries registered in the period + extras (income tx).
  const curYear = now.getFullYear();
  const salaryInPeriod = period === 'year'
    ? salaries.filter((s) => s.year === curYear && s.month === now.getMonth() + 1).reduce((a, s) => a + s.amountCents, 0)
    : salaries.filter((s) => s.year === curYear).reduce((a, s) => a + s.amountCents, 0);
  const periodSalaryCents = salaryInPeriod;
  const periodExtrasCents = periodTx.filter((tx) => tx.type === 'income').reduce((a, tx) => a + tx.amountCents, 0);
  const incomeTotal = salaryInPeriod + periodExtrasCents;

  // Loan: recurring transfers (mockup shows "Empréstimo ao tio - 50% da casa").
  const loanInfo = (() => {
    const loanTx = monthTx.find((tx) => /tio|loan|empr[eé]stimo/i.test(tx.description ?? ''));
    const salary = salaries.find((s) => s.year === now.getFullYear() && s.month === now.getMonth() + 1);
    return loanTx ? { monthlyCents: loanTx.amountCents, pctOfSalary: salary ? Math.round((loanTx.amountCents / salary.amountCents) * 100) : null } : null;
  })();

  // Months of this year without a registered salary (for the AI tip card).
  const missingSalaryMonths = (() => {
    let n = 0;
    for (let m = 1; m <= now.getMonth() + 1; m++) {
      if (!salaries.some((s) => s.year === curYear && s.month === m)) n++;
    }
    return n;
  })();

  // Budget usage
  let budgetTotal = 0, budgetUsed = 0;
  for (const b of budgets) {
    const used = monthTx.filter((tx) => tx.type === 'expense' && tx.categoryId === b.categoryId)
      .reduce((a, tx) => a + tx.amountCents, 0);
    budgetTotal += b.limitCents;
    budgetUsed += used;
  }


  return (
    <div className="min-h-screen bg-[#05060a] text-white"
      style={{ background: 'radial-gradient(900px 500px at 15% -10%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(800px 450px at 85% 110%, rgba(236,72,153,0.14), transparent 60%), #05060a' }}>
      <div className="dash-shell w-full mx-auto flex flex-col min-h-0">
        <div className="kpi-strip" style={{ marginBottom: 16 }}>
          {[
            { label: t('panel.totalSpent'), value: formatMoney(kpis.totalSpentCents, settings.currency, settings.language) },
            { label: t('panel.dailyAverage'), value: formatMoney(kpis.avgDailyCents, settings.currency, settings.language) },
            { label: t('panel.expenseCount'), value: String(kpis.expenseCount) },
            { label: t('panel.largestExpense'), value: formatMoney(kpis.largestExpenseCents, settings.currency, settings.language) },
            { label: t('panel.topCategory'), value: kpis.topCategoryName ?? '—' },
          ].map((m) => (
            <div key={m.label} className="kpi-card">
              <div className="kpi-label">{m.label}</div>
              <div className="kpi-num">{m.value}</div>
            </div>
          ))}
        </div>

        {/* Mockup grid: 12 columns. Row 1 = chart(6) + savings/expenses(3) + donut(3);
           Row 2 = calendar(4) + monthly table(5) + loan/AI(3). */}
        <div className="dash-grid">

        {/* Row 1 (mockup): analysis chart span 6 */}
        <div className="mock-card dash-span-6 flex flex-col">
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
          </div>

          {/* Row 1: savings + expenses stacked (span 3, mockup style) */}
          <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateRows: '1fr 1fr', gap: 16 }}>
            <SavingsCard title={t('panel.monthlySavings')} valueCents={Math.max(0, savings)}
              perMonthCents={monthIncome - monthExpense} salaryCents={periodSalaryCents} extrasCents={periodExtrasCents}
              pctOfIncome={incomeTotal > 0 ? Math.round((Math.max(0, savings) / incomeTotal) * 100) : null}
              settings={settings} t={t} />
            <ExpensesCard title={t('panel.monthlyExpenses')} valueCents={kpis.totalSpentCents}
              count={kpis.expenseCount} avgDailyCents={kpis.avgDailyCents}
              pctOfIncome={incomeTotal > 0 ? Math.round((kpis.totalSpentCents / incomeTotal) * 100) : null}
              settings={settings} t={t} />
          </div>

          {/* Row 1: category donut (span 3) */}
          <div className="mock-card dash-span-3">
            <div className="mock-head">
              <span className="mock-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8"/></svg></span>
              {t('panel.byCategory')}
            </div>
            <CategoryDonut catTotals={catTotals} totalCents={kpis.totalSpentCents} />
          </div>

          {/* Row 2: calendar (4) + monthly table (5) + loan/AI (3) */}
          <div className="dash-span-4">
            <DailySpendCalendar monthTx={monthTx} settings={settings} t={t} />
          </div>
          <div className="mock-card dash-span-5">
            <div className="mock-head">
              <span className="mock-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/></svg></span>
              {t('panel.monthlyBreakdown')} · {now.getFullYear()}
            </div>
            <MonthlyTable rows={monthlyBars} settings={settings} t={t} />
          </div>
          <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateRows: '1fr auto', gap: 16 }}>
            <LoanCard loan={loanInfo} settings={settings} t={t} />
            <AiTipCard savingsPct={incomeTotal > 0 ? Math.round((Math.max(0, savings) / incomeTotal) * 100) : null}
              missingMonths={missingSalaryMonths} topCategory={kpis.topCategoryName} t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}
