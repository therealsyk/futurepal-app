import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import type { AppSettings } from '../core/settings';
import type { Transaction, Budget, Category } from '../db/database';

// ── Pure helpers (integer cents only, no float money) ────────────────────────
function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Build a smooth SVG path (Catmull-Rom -> cubic Bezier) from points [x,y].
function smoothPath(points: { x: number; y: number }[]): string {
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

const AVATAR_COLORS = ['#8b5cf6', '#3b82f6', '#ec4899', '#22d3ee', '#f59e0b', '#10b981'];

function avatarFor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ── Card shell ────────────────────────────────────────────────────────────────
function GlassCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-3xl border border-white/[0.12] backdrop-blur-xl
        shadow-[0_28px_70px_-28px_rgba(0,0,0,0.85),0_10px_30px_-14px_rgba(139,92,246,0.35)] ${className}`}
      style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 45%, rgba(99,102,241,0.06) 100%)' }}
    >
      {children}
    </div>
  );
}

function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-white/90 tracking-wide">{title}</h3>
      {sub && <span className="text-xs text-white/50">{sub}</span>}
    </div>
  );
}

// ── Income Analysis: line + filled area ───────────────────────────────────────
function IncomeChart({ series }: {
  series: { label: string; income: number; expense: number }[];
}) {
  const W = 640;
  const H = 340;
  const pad = 18;
  const max = Math.max(1, ...series.flatMap((s) => [s.income, s.expense]));
  const n = Math.max(1, series.length);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (n - 1 || 1);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);

  const incPts = series.map((s, i) => ({ x: x(i), y: y(s.income) }));
  const expPts = series.map((s, i) => ({ x: x(i), y: y(s.expense) }));
  const incLine = smoothPath(incPts);
  const expLine = smoothPath(expPts);
  const area = incLine + ` L ${x(n - 1)} ${H - pad} L ${x(0)} ${H - pad} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <linearGradient id="incFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#6366f1" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ec4899" stopOpacity="0.10" />
        </linearGradient>
        <linearGradient id="incStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="50%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad} y1={pad + g * (H - 2 * pad)} x2={W - pad} y2={pad + g * (H - 2 * pad)}
          stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      ))}
      <path d={area} fill="url(#incFill)" opacity="1" />
      <path d={expLine + ` L ${x(n - 1)} ${H - pad} L ${x(0)} ${H - pad} Z`} fill="rgba(236,72,153,0.10)" opacity="0.9" />
      <path d={incLine} fill="none" stroke="url(#incStroke)" strokeWidth="4" strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.6))' }} />
      <path d={expLine} fill="none" stroke="rgba(236,72,153,0.55)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4" />
      {incPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="#a78bfa" />
      ))}
      {series.length > 0 && (
        <text x={pad} y={H - 6} fill="rgba(255,255,255,0.4)" font-size="11">{series[0].label}</text>
      )}
      {series.length > 1 && (
        <text x={W - pad} y={H - 6} fill="rgba(255,255,255,0.4)" font-size="11" textAnchor="end">{series[series.length - 1].label}</text>
      )}
    </svg>
  );
}

// ── Progress bar card ─────────────────────────────────────────────────────────
function ProgressCard({ title, value, total, percent, tone }: {
  title: string;
  value: number;
  total: number;
  percent: number;
  tone: 'violet' | 'magenta';
}) {
  const grad = tone === 'violet'
    ? 'linear-gradient(90deg,#6366f1,#8b5cf6,#a78bfa)'
    : 'linear-gradient(90deg,#ec4899,#f472b6,#f9a8d4)';
  return (
    <GlassCard className="p-5">
      <CardTitle title={title} />
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold text-white">{formatMoney(value, 'EUR', 'en')}</div>
          <div className="text-xs text-white/50">{formatMoney(total, 'EUR', 'en')} total</div>
        </div>
        <div className="text-3xl font-black text-white/90">{percent}%</div>
      </div>
      <div className="mt-4 h-3.5 rounded-full bg-white/8 overflow-hidden" style={{ boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.5)' }}>
        <div className="h-full rounded-full" style={{ width: `${clamp(percent, 0, 100)}%`, background: grad, boxShadow: '0 0 12px rgba(139,92,246,0.45)' }} />
      </div>
    </GlassCard>
  );
}

// ── Donut for budget usage ────────────────────────────────────────────────────
function Donut({ used, budget }: { used: number; budget: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const over = budget > 0 && used > budget;
  const frac = budget > 0 ? clamp(used / budget, 0, 1) : 0;
  const dash = frac * c;
  const color = over ? '#f43f5e' : frac > 0.85 ? '#f59e0b' : '#22c55e';
  return (
    <svg viewBox="0 0 140 140" width="120" height="120">
      <defs>
        <linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={over ? '#ec4899' : '#8b5cf6'} />
        </linearGradient>
      </defs>
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="url(#donutGrad)" strokeWidth="12"
        strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={c * 0.25} strokeLinecap="round" />
      <text x="70" y="66" textAnchor="middle" fill="white" font-size="22" font-weight="700">{budget > 0 ? Math.round((used / budget) * 100) : 0}</text>
      <text x="70" y="84" textAnchor="middle" fill="rgba(255,255,255,0.5)" font-size="10">used</text>
    </svg>
  );
}

// ── Daily Spend calendar ──────────────────────────────────────────────────────
function DailySpendCalendar({ monthTx, settings, t }: {
  monthTx: Transaction[];
  settings: AppSettings;
  t: (k: string) => string;
}) {
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
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-4">
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
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const v = spend[day];
          return (
            <div key={day}
              className="rounded-lg border border-white/10 backdrop-blur p-1.5 text-center overflow-hidden transition hover:border-violet-400/40 hover:scale-[1.04]"
              style={{ background: cellColor(v), boxShadow: v > 0 ? '0 6px 16px -8px rgba(139,92,246,0.55)' : 'none' }}>
              <div className="text-[9px] text-white/55">{day}</div>
              <div className="text-[10px] font-semibold text-white/90 truncate">
                {v > 0 ? formatMoney(v, settings.currency, settings.language) : ''}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-white/50">
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [allTx, allB, allC] = await Promise.all([
          db.transactions.toArray(),
          db.budgets.toArray(),
          db.categories.toArray(),
        ]);
        if (!alive) return;
        setTxs(allTx.filter((x) => !x.deletedAt));
        setBudgets(allB.filter((x) => !x.deletedAt));
        setCats(allC.filter((x) => !x.deletedAt));
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

  // Income analysis series (last 6 months, monthly)
  const series: { label: string; income: number; expense: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let inc = 0, exp = 0;
    for (const tx of txs) {
      if (!tx.date.startsWith(key)) continue;
      if (tx.type === 'income') inc += tx.amountCents;
      else exp += tx.amountCents;
    }
    series.push({ label: d.toLocaleString(settings.language, { month: 'short' }), income: inc, expense: exp });
  }

  const monthIncome = monthTx.filter((tx) => tx.type === 'income').reduce((a, tx) => a + tx.amountCents, 0);
  const monthExpense = monthTx.filter((tx) => tx.type === 'expense').reduce((a, tx) => a + tx.amountCents, 0);
  const savings = monthIncome - monthExpense;
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

  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? '—';

  const recent = [...monthTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return (
    <div className="min-h-screen bg-[#05060a] text-white"
      style={{ background: 'radial-gradient(900px 500px at 15% -10%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(800px 450px at 85% 110%, rgba(236,72,153,0.14), transparent 60%), #05060a' }}>
      <div className="max-w-[1360px] mx-auto p-4 flex flex-col min-h-screen">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold tracking-wide">{t('panel.title')}</h1>
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-4 py-2 text-sm text-white/70">
            {settings.currency}
          </div>
        </div>

        {/* Top row: Income analysis (left) + savings/expenses (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 flex-1">
          <GlassCard className="lg:col-span-2 p-4 flex flex-col">
            <CardTitle title={t('panel.incomeAnalysis')} sub={t('panel.income')} />
            <div className="mt-2 flex-1 min-h-[300px]">
              <IncomeChart series={series} />
            </div>
          </GlassCard>

          <div className="grid grid-cols-1 gap-2">
            <ProgressCard title={t('panel.monthlySavings')} value={savings} total={monthIncome} percent={savingsPct} tone="violet" />
            <ProgressCard title={t('panel.monthlyExpenses')} value={monthExpense} total={monthIncome} percent={expensePct} tone="magenta" />
          </div>
        </div>

        {/* Bottom row: recent (left) + budget (center) + calendar (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mt-2 flex-1">
          <GlassCard className="p-5">
            <CardTitle title={t('panel.recentTransactions')} />
            <ul className="mt-4 space-y-3">
              {recent.length === 0 && <li className="text-sm text-white/50">{t('panel.noData')}</li>}
              {recent.map((tx) => (
                <li key={tx.id} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: avatarFor(catName(tx.categoryId)) }}>
                    {catName(tx.categoryId).slice(0, 1)}
                  </div>
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

          <GlassCard className="p-5">
            <CardTitle title={t('panel.budgetUsage')} />
            <div className="mt-4 flex items-center justify-center">
              <Donut used={budgetUsed} budget={budgetTotal} />
            </div>
            <div className="mt-3 flex justify-between text-xs text-white/50">
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
