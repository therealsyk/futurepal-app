import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import type { AppSettings } from '../core/settings';
import type { Transaction, Budget, Category, Salary, Goal, Recurring, Account, Transfer } from '../db/database';
import { periodKpis, contributeToGoal, materializeDueRecurrings } from '../core/finance';
import { txsOfAccount, defaultAccountId, ALL_ACCOUNTS, accountBalanceCents, netWorthCents, salariesUntil, loadTransfers, addTransfer, suggestedSource } from '../core/accounts';
import { loadLayout, saveLayout, moveWidget, removeWidget, swapWidget, addWidget, nudgeWidget, DEFAULT_LAYOUT, type Layout } from '../core/dashLayout';
import { WidgetGrid } from '../ui/WidgetGrid';
import { AccountSwitch, PickMenu, Sheet, ICON, catLabel, useAccounts, CategorySelect } from '../ui/fx';
import { todayISO, monthStart, monthEnd } from '../core/dates';

// Painel — visual "clean".
// Toda a lógica trabalha em cêntimos inteiros; todo o texto passa por t().

type Period = 'month' | 'year';
type TFn = ReturnType<typeof useTranslation>['t'];

const PALETTE = ['#8b7cf6', '#5fd4c4', '#e58fd3', '#f5b85a', '#6aa8ff', '#4ade9b', '#f87171', '#b9a7ff', '#7dd3fc', '#fca5a5', '#a3e635', '#c4b5fd'];
const pad = (n: number) => String(n).padStart(2, '0');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
    // y dos pontos de controlo limitado ao intervalo [p1, p2]: a curva não "passa" abaixo de 0 nem acima do valor real.
    const lo = Math.min(p1.y, p2.y), hi = Math.max(p1.y, p2.y);
    const clampY = (v: number) => Math.min(hi, Math.max(lo, v));
    const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

const Ic = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ARROW = 'M9 6l6 6-6 6';

function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`fx-card ${className}`}>
      {title && (
        <div className="fx-card-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Meter({ ratio }: { ratio: number | null }) {
  const filled = ratio === null ? 0 : Math.max(0, Math.min(1, ratio));
  const rest = Math.max(1, Math.round((1 - filled) * 8));
  return (
    <div className="fx-meter" aria-hidden="true">
      {filled > 0 && <div className="fx-meter-fill" style={{ width: `${filled * 100}%` }} />}
      <div className="fx-meter-rest">{Array.from({ length: rest }, (_, i) => <i key={i} />)}</div>
    </div>
  );
}

// ── Caixa de indicador (Despesas / Poupança / Rendimento / Categoria) ──
function Kpi({ icon, color, label, value, pct, pctTone = 'neutral', sub }: {
  icon: string; color: string; label: string; value: string;
  pct?: string | null; pctTone?: 'good' | 'bad' | 'neutral'; sub: ReactNode;
}) {
  return (
    <section className="fx-card fx-kpi">
      <div className="fx-kpi-label">{label}</div>
      <div className="fx-kpi-row">
        <span className="fx-kpi-ic" style={{ background: color }}><Ic d={icon} size={20} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="fx-kpi-value">
            <span>{value}</span>
            {pct && <span className={'fx-chip ' + pctTone}>{pct}</span>}
          </div>
          <div className="fx-kpi-sub">{sub}</div>
        </div>
      </div>
    </section>
  );
}

// ── Gráfico de área: rendimento vs despesas por mês ─────────────────────
function OverviewChart({ series, upTo, money, t }: {
  series: { label: string; earning: number; spending: number }[];
  upTo: number; // último índice com dados (meses futuros não são desenhados)
  money: (c: number) => string;
  t: TFn;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 200;
  const max = Math.max(1, ...series.map((s) => Math.max(s.earning, s.spending)));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => (series.length <= 1 ? 0 : (i / (series.length - 1)) * W);
  const y = (v: number) => H - (v / top) * H;
  const pts = (k: 'earning' | 'spending') => series.slice(0, upTo + 1).map((s, i) => ({ x: x(i), y: y(s[k]) }));
  const line = (k: 'earning' | 'spending') => smoothPath(pts(k));
  const area = (k: 'earning' | 'spending') => `${line(k)} L ${x(upTo)} ${H} L 0 ${H} Z`;
  const ticks = [top, top * 0.75, top * 0.5, top * 0.25, 0];
  const short = (c: number) => {
    const v = c / 100;
    return v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v));
  };
  const hv = hover !== null ? series[hover] : null;

  return (
    <div className="fx-chart" onMouseLeave={() => setHover(null)}>
      <div className="fx-yaxis">{ticks.map((v) => <span key={v}>{short(v)}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('panel.overview')}>
        <defs>
          <linearGradient id="fxEarn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="fxSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="var(--track)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area('earning')} fill="url(#fxEarn)" />
        <path d={line('earning')} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <path d={area('spending')} fill="url(#fxSpend)" />
        <path d={line('spending')} fill="none" stroke="var(--teal)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        {series.map((_, i) => (
          <rect key={i} x={x(i) - W / series.length / 2} y="0" width={W / series.length} height={H}
            fill="transparent" onMouseEnter={() => setHover(i <= upTo ? i : null)} />
        ))}
      </svg>
      {hv && hover !== null && (
        <div className="fx-bubble" style={{
          left: `calc(44px + (100% - 44px) * ${x(hover) / W})`,
          top: `calc((100% - 22px) * ${y(Math.max(hv.earning, hv.spending)) / H})`,
        }}>
          {hv.label} · {money(hv.spending)}
          <small>{t('panel.earning')}: {money(hv.earning)}</small>
        </div>
      )}
      <div className="fx-xaxis">{series.map((s) => <span key={s.label}>{s.label}</span>)}</div>
    </div>
  );
}

// ── Donut de despesas por categoria (segmentos arredondados) ────────────
function ExpensesDonut({ items, total, money, t }: {
  items: { name: string; cents: number; color: string }[];
  total: number;
  money: (c: number) => string;
  t: TFn;
}) {
  const r = 62, C = 2 * Math.PI * r, gap = items.length > 1 ? 3 : 0;
  let offset = 0;
  const segs = items.map((it) => {
    const len = (it.cents / total) * C;
    const seg = { ...it, dash: Math.max(0.01, len - gap), offset };
    offset += len;
    return seg;
  });
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>
      <div style={{ position: 'relative', width: 170, height: 170 }}>
        <svg width="170" height="170" viewBox="0 0 170 170" role="img" aria-label={t('panel.allExpenses')}>
          <circle cx="85" cy="85" r={r} fill="none" stroke="var(--track)" strokeWidth="20" />
          <g transform="rotate(-90 85 85)">
            {segs.map((s) => (
              <circle key={s.name} cx="85" cy="85" r={r} fill="none" stroke={s.color} strokeWidth="20"
                strokeDasharray={`${s.dash} ${C}`} strokeDashoffset={-s.offset - gap / 2} />
            ))}
          </g>
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
          <span className="fx-label">{t('panel.total')}</span>
          <b className="fx-num" style={{ fontSize: 18 }}>{money(total)}</b>
        </div>
      </div>
      <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 12.5 }}>
        {items.slice(0, 4).map((it) => (
          <span key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <i className="fx-dot" style={{ background: it.color }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
            <span className="fx-muted" style={{ marginLeft: 'auto' }}>{Math.round((it.cents / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// 'goalbar:abc' → ['goalbar', 'abc']; widgets fixos → [id, ''].
function splitId(id: string): [string, string] {
  const i = id.indexOf(':');
  return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)];
}
// A outra variante do mesmo widget (anel ↔ barra), para não pôr as duas por engano.
function twinOf(id: string): string {
  const [k, r] = splitId(id);
  const twin: Record<string, string> = { goal: 'goalbar', goalbar: 'goal', account: 'accountbar', accountbar: 'account' };
  return twin[k] ? twin[k] + ':' + r : id;
}

// ── Anel de progresso das metas ─────────────────────────────────────────
function Ring({ ratio, color, size = 44 }: { ratio: number; color: string; size?: number }) {
  const sw = size >= 80 ? 8 : 4;
  const r = size / 2 - sw / 2 - 1, C = 2 * Math.PI * r, p = Math.max(0, Math.min(1, ratio));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${p * C} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: size >= 80 ? 20 : 10.5, fontWeight: 650 }}>
        {Math.round(p * 100)}%
      </span>
    </div>
  );
}

// ── Barra de progresso segmentada (parte cheia + marcas no resto) ─────
function SegBar({ ratio, tone = 'accent', label }: { ratio: number; tone?: 'accent' | 'amber' | 'teal'; label: string }) {
  const p = Math.max(0, Math.min(1, ratio));
  return (
    <div className={'fx-segbar ' + tone} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <div className="fx-segbar-fill" style={{ width: `max(${(p * 100).toFixed(2)}%, ${p > 0 ? '18px' : '0px'})` }} />
      <div className="fx-segbar-ticks" />
    </div>
  );
}

// Meses (inteiros, mínimo 1) entre hoje e uma data AAAA-MM-DD; null se já passou.
function monthsUntil(dateISO: string): number | null {
  const now = new Date();
  const [y, m, d] = dateISO.split('-').map(Number);
  const diff = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) + (d >= now.getDate() ? 0 : -1);
  if (diff < 0) return null;
  return Math.max(1, diff);
}

// ── Calendário de gasto diário (dia + valor debaixo, como no Excel) ────
function DailyCalendar({ txs, settings, money, t, selYear, selMonth, period, onPick }: {
  txs: Transaction[]; settings: AppSettings; money: (c: number) => string; t: TFn;
  selYear: number; selMonth: number; period: Period; onPick: (year: number, month: number) => void;
}) {
  const navigate = useNavigate();
  const today = new Date();
  const [cur, setCur] = useState({ y: selYear, m: selMonth - 1 });
  // Acompanha o período escolhido no topo do Painel.
  useEffect(() => { setCur({ y: selYear, m: selMonth - 1 }); }, [selYear, selMonth]);

  if (period === 'year') {
    const months = Array.from({ length: 12 }, (_, i) => {
      const p = `${selYear}-${pad(i + 1)}`;
      const v = txs.filter((tx) => tx.type === 'expense' && tx.date.startsWith(p)).reduce((a, tx) => a + tx.amountCents, 0);
      return { i, v, label: cap(new Date(selYear, i, 1).toLocaleDateString(settings.language, { month: 'short' }).replace('.', '')) };
    });
    const max = Math.max(1, ...months.map((m) => m.v));
    const total = months.reduce((a, m) => a + m.v, 0);
    return (
      <Card title={t('panel.monthlySpend')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontSize: 13 }}>{selYear}</span>
          <span className="fx-num" style={{ fontSize: 13 }}>{money(total)}</span>
        </div>
        <div className="fx-cal-year">
          {months.map((m) => (
            <button key={m.i} type="button" className={'fx-cal-m' + (selYear === today.getFullYear() && m.i === today.getMonth() ? ' today' : '')}
              onClick={() => onPick(selYear, m.i + 1)} aria-label={`${m.label}: ${money(m.v)}`} title={t('panel.openMonth')}>
              <span>{m.label}</span>
              <b>{m.v > 0 ? money(m.v) : '—'}</b>
              <i style={{ width: `${Math.round((m.v / max) * 100)}%` }} />
            </button>
          ))}
        </div>
      </Card>
    );
  }

  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const prefix = `${cur.y}-${pad(cur.m + 1)}`;
  const spend = new Array<number>(days + 1).fill(0);
  for (const tx of txs) {
    if (tx.type !== 'expense' || !tx.date.startsWith(prefix)) continue;
    spend[parseInt(tx.date.slice(8, 10), 10)] += tx.amountCents;
  }
  const total = spend.reduce((a, b) => a + b, 0);
  const first = settings.firstDayOfWeek ?? 1;
  const lead = (new Date(cur.y, cur.m, 1).getDay() - first + 7) % 7;
  const wk = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(settings.language, { weekday: 'narrow' }));
  const title = new Date(cur.y, cur.m, 1).toLocaleDateString(settings.language, { month: 'long', year: 'numeric' });
  const isToday = (d: number) => cur.y === today.getFullYear() && cur.m === today.getMonth() && d === today.getDate();
  // As setas do calendário mudam o período de todo o Painel (assim tudo fica coerente).
  const move = (n: number) => {
    const d = new Date(cur.y, cur.m + n, 1);
    onPick(d.getFullYear(), d.getMonth() + 1);
  };

  return (
    <Card title={t('panel.dailySpend')} action={
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="fx-link" onClick={() => move(-1)} aria-label={t('panel.prevMonth')}><Ic d="M15 6l-6 6 6 6" size={14} /></button>
        <button type="button" className="fx-link" onClick={() => move(1)} aria-label={t('panel.nextMonth')}><Ic d={ARROW} size={14} /></button>
      </div>
    }>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>{cap(title)}</span>
        <span className="fx-num" style={{ fontSize: 13 }}>{money(total)}</span>
      </div>
      <div className="fx-cal">
        {wk.map((w, i) => <span key={i} className="fx-cal-h">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={'e' + i} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1, v = spend[d];
          const date = `${prefix}-${pad(d)}`;
          return (
            <button key={d} type="button" className={'fx-cal-d' + (isToday(d) ? ' today' : '')}
              onClick={() => navigate(`/dia/${date}`)}
              aria-label={`${d}: ${money(v)}`} title={money(v)}>
              <span>{d}</span>
              <b>{v > 0 ? money(v) : ''}</b>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ── Painel ──────────────────────────────────────────────────────────────
export function Dashboard() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [salaries, setSalaries] = useState<Salary[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saved = loadPeriod();
  const [period, setPeriod] = useState<Period>(saved.period);
  const [selY, setSelY] = useState(saved.year);
  const [selM, setSelM] = useState(saved.month);
  useEffect(() => { savePeriod({ period, year: selY, month: selM }); }, [period, selY, selM]);
  // Avança/recua um mês ou um ano, conforme o modo.
  const stepPeriod = (n: number) => {
    if (period === 'year') { setSelY((y) => y + n); return; }
    const d = new Date(selY, selM - 1 + n, 1);
    setSelY(d.getFullYear()); setSelM(d.getMonth() + 1);
  };
  const pickMonth = (y: number, m: number) => { setPeriod('month'); setSelY(y); setSelM(m); };
  const { accounts, active, setActive } = useAccounts();
  const [recurrings, setRecurrings] = useState<Recurring[]>([]);
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const [editing, setEditing] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [contrib, setContrib] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await materializeDueRecurrings(db, todayISO()).catch(() => 0);
        const [allTx, allB, allC, allS, allG, allR] = await Promise.all([
          db.transactions.toArray(), db.budgets.toArray(), db.categories.toArray(),
          db.salaries.toArray(), db.goals.toArray(), db.recurrings.toArray(),
        ]);
        if (!alive) return;
        setTxs(allTx.filter((x) => !x.deletedAt));
        setBudgets(allB.filter((x) => !x.deletedAt));
        setCats(allC.filter((x) => !x.deletedAt));
        setSalaries(allS.filter((x) => !x.deletedAt));
        setTransfers(await loadTransfers(db));
        setGoals(allG.filter((x) => !x.deletedAt));
        setRecurrings(allR.filter((x) => !x.deletedAt));
        setSettings(loadSettings());
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const lang = settings.language || i18n.language;
  const money = (c: number) => formatMoney(Math.round(c), settings.currency, lang);
  const now = new Date();
  const year = selY;
  const month = selM;

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const catName = (c?: Category) => (c ? catLabel(t, c) : '—');
  const catColor = (c: Category | undefined, i: number) => c?.color || PALETTE[i % PALETTE.length];

  if (loading) return <div className="fx-page fx-muted">{t('panel.loading')}</div>;
  if (error) return <div className="fx-page fx-neg">{error}</div>;

  // Período escolhido (mês atual ou ano atual)
  const prefix = period === 'month' ? `${year}-${pad(month)}` : String(year);
  const accTxs = txsOfAccount(txs, active, accounts);
  const periodTx = accTxs.filter((tx) => tx.date.startsWith(prefix));
  const kpis = periodKpis(periodTx, cats);
  const daysInPeriod = period === 'month'
    ? new Date(year, month, 0).getDate()
    : (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365);
  const periodStart = period === 'month' ? monthStart(year, month) : `${year}-01-01`;
  const periodEnd = period === 'month' ? monthEnd(year, month) : `${year}-12-31`;
  const todayStr = todayISO();
  // Dias já decorridos do período (0 = período no futuro; todos = período no passado).
  const elapsedDays = todayStr < periodStart ? 0 : todayStr > periodEnd ? daysInPeriod
    : Math.round((Date.parse(todayStr + 'T00:00:00Z') - Date.parse(periodStart + 'T00:00:00Z')) / 86400000) + 1;
  // Saldos "à data": fim do período, ou hoje se o período ainda não acabou.
  const asOf = periodEnd < todayStr ? periodEnd : todayStr;
  const txsAsOf = txs.filter((x) => x.date <= asOf);
  const transfersAsOf = transfers.filter((x) => x.date <= asOf);
  const periodLabel = period === 'month'
    ? cap(new Date(year, month - 1, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' }))
    : String(year);
  const firstDataYear = txs.reduce((min, x) => Math.min(min, parseInt(x.date.slice(0, 4), 10) || min), now.getFullYear() - 5); // pelo menos 5 anos para trás
  const yearOptions = Array.from({ length: Math.max(year, now.getFullYear() + 1) - Math.min(firstDataYear, year) + 1 },
    (_, i) => Math.max(year, now.getFullYear() + 1) - i);

  // Salários pertencem à conta predefinida (ou a todas).
  const salaryHere = active === ALL_ACCOUNTS || active === defaultAccountId(accounts);
  const salaryCents = !salaryHere ? 0 : salaries
    .filter((s) => s.year === year && (period === 'year' || s.month === month))
    .reduce((a, s) => a + s.amountCents, 0);
  const extrasCents = periodTx.filter((tx) => tx.type === 'income').reduce((a, tx) => a + tx.amountCents, 0);
  const income = salaryCents + extrasCents;
  const spent = kpis.totalSpentCents;
  const savings = income > 0 ? income - spent : null;
  const pctSpent = income > 0 ? spent / income : null;
  const avgDay = Math.round(spent / Math.max(1, elapsedDays || daysInPeriod));
  const prevPrefix = period === 'month'
    ? (month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`)
    : String(year - 1);
  const prevSpent = accTxs.filter((tx) => tx.type === 'expense' && tx.date.startsWith(prevPrefix)).reduce((a, tx) => a + tx.amountCents, 0);
  const deltaSpent = prevSpent > 0 ? (spent - prevSpent) / prevSpent : null;
  const pctTxt = (r: number | null) => (r === null ? null : `${Math.round(r * 100)}%`);

  // Despesas por categoria (ordenadas)
  const byCat = new Map<string, number>();
  for (const tx of periodTx) {
    if (tx.type === 'expense') byCat.set(tx.categoryId, (byCat.get(tx.categoryId) ?? 0) + tx.amountCents);
  }
  const catItems = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, cents], i) => ({ name: catName(catById.get(id)), cents, color: catColor(catById.get(id), i) }));

  // Série mensal do ano (rendimento = salário + receitas; despesas)
  const series = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${pad(i + 1)}`;
    let spending = 0, extra = 0;
    for (const tx of accTxs) {
      if (!tx.date.startsWith(key)) continue;
      if (tx.type === 'expense') spending += tx.amountCents; else extra += tx.amountCents;
    }
    const sal = !salaryHere ? 0 : salaries.filter((s) => s.year === year && s.month === i + 1).reduce((a, s) => a + s.amountCents, 0);
    return {
      label: cap(new Date(year, i, 1).toLocaleDateString(lang, { month: 'short' }).replace('.', '')),
      earning: sal + extra,
      spending,
    };
  });
  const yearSpent = series.reduce((a, s) => a + s.spending, 0);

  // Orçamento do período: o mês escolhido, ou a soma de todos os meses do ano
  const periodBudgets = budgets.filter((b) => b.year === year && (period === 'year' || b.month === month));
  const budgetLimit = periodBudgets.reduce((a, b) => a + b.limitCents, 0);
  const budgetUsed = periodBudgets.reduce((a, b) => a + accTxs
    .filter((tx) => tx.type === 'expense' && tx.categoryId === b.categoryId && tx.date.startsWith(`${b.year}-${pad(b.month)}`))
    .reduce((s, tx) => s + tx.amountCents, 0), 0);

  // Transações recentes
  const recent = [...periodTx].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 7);
  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'short' });

  const activeGoals = [...goals].sort((a, b) => (a.targetDate ?? '9').localeCompare(b.targetDate ?? '9')).slice(0, 3);
  const goalColors = ['var(--accent)', 'var(--teal)', 'var(--pink)'];

  // ── Janelas (widgets) ──────────────────────────────────────────────────
  const STATIC_WIDGETS = ['goals', 'budget', 'summary', 'overview', 'categories', 'calendar', 'recent', 'accounts', 'forecast', 'last7', 'topExpenses', 'upcoming', 'checklist'];
  const salaryToDate = salariesUntil(salaries, parseInt(asOf.slice(0, 4), 10), parseInt(asOf.slice(5, 7), 10));
  const balOf = (a: Account) => accountBalanceCents(a, txsAsOf, accounts, salaryToDate, transfersAsOf);
  const currentOf = (g: Goal) => (g.accountIds && g.accountIds.length
    ? accounts.filter((a) => g.accountIds!.includes(a.id)).reduce((sum, a) => sum + balOf(a), 0)
    : g.currentCents);
  const defId = defaultAccountId(accounts);
  const seeAll = (to: string, label: string) => <Link to={to} className="fx-link" aria-label={label}><Ic d={ARROW} size={14} /></Link>;
  const typeIcon: Record<Account['type'], string> = { spending: ICON.wallet, savings: ICON.piggy, debt: ICON.debt };

  const widgetLabel = (id: string): string => {
    const [kind, ref] = splitId(id);
    if (kind === 'goal' || kind === 'goalbar') return goals.find((g) => g.id === ref)?.name ?? '';
    if (kind === 'account' || kind === 'accountbar') return accounts.find((a) => a.id === ref)?.name ?? '';
    return t('panel.w_' + id);
  };
  const widgetValid = (id: string) => {
    const [kind, ref] = splitId(id);
    if (kind === 'goal' || kind === 'goalbar') return goals.some((g) => g.id === ref);
    if (kind === 'account') return accounts.some((a) => a.id === ref);
    if (kind === 'accountbar') return accounts.some((a) => a.id === ref && a.type === 'debt');
    return STATIC_WIDGETS.includes(id);
  };
  // Botão "Anel / Barra" visível no modo Personalizar.
  const styleSwitch = (id: string, ringId: string, barId: string) => editing ? (
    <div className="fx-seg sm" role="group" aria-label={t('panel.widgetStyle')}>
      <button type="button" className={id === ringId ? 'on' : ''} aria-pressed={id === ringId} onClick={() => setLayout(swapWidget(layout, id, ringId))}>{t('panel.styleRing')}</button>
      <button type="button" className={id === barId ? 'on' : ''} aria-pressed={id === barId} onClick={() => setLayout(swapWidget(layout, id, barId))}>{t('panel.styleBar')}</button>
    </div>
  ) : null;

  const setLayout = (l: Layout) => { setLayoutState(l); saveLayout(l); };
  const placed = new Set(layout.flat());

  const submitContribution = async (goalId: string) => {
    const cents = parseMoneyToCents(contrib[goalId] || '');
    if (cents === null || cents <= 0) return;
    await contributeToGoal(db, goalId, cents);
    setContrib((c) => ({ ...c, [goalId]: '' }));
    setGoals((await db.goals.toArray()).filter((x) => !x.deletedAt));
  };

  const renderWidget = (id: string): ReactNode | null => {
    const [wKind, wRef] = splitId(id);
    if (wKind === 'goal' || wKind === 'goalbar') {
      const g = goals.find((x) => x.id === wRef);
      if (!g) return null;
      const cur = currentOf(g);
      const ratio = g.targetCents > 0 ? cur / g.targetCents : 0;
      const left = Math.max(0, g.targetCents - cur);
      const linked = !!(g.accountIds && g.accountIds.length);
      const action = styleSwitch(id, 'goal:' + g.id, 'goalbar:' + g.id) ?? seeAll('/metas', t('panel.seeAll'));
      const contribRow = !linked && (
        <div className="fx-inline">
          <input className="fx-input" inputMode="decimal" placeholder={t('goals.amount')} aria-label={t('goals.amount')} value={contrib[g.id] ?? ''}
            onChange={(e) => setContrib({ ...contrib, [g.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') submitContribution(g.id); }} />
          <button type="button" className="fx-btn" onClick={() => submitContribution(g.id)}>{t('goals.contribute')}</button>
        </div>
      );
      if (wKind === 'goalbar') {
        const months = g.targetDate ? monthsUntil(g.targetDate) : null;
        const perMonth = months && left > 0 ? Math.ceil(left / months) : null;
        const pctTxt1 = new Intl.NumberFormat(settings.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.max(0, Math.min(ratio, 9.99)) * 100);
        return (
          <Card title={g.name} action={action} className="fx-barcard">
            <div className="fx-bar-big">{money(cur)}</div>
            <div className="fx-bar-sub">
              {perMonth !== null && <>{t('panel.perMonthNeeded', { value: money(perMonth) })} · </>}
              {t('panel.ofTarget', { value: money(g.targetCents) })} · {left > 0 ? t('panel.remaining', { value: money(left) }) : t('panel.goalReached')}
            </div>
            <SegBar ratio={ratio} label={g.name} />
            <div className="fx-bar-foot">
              <span>{t('panel.pctOfGoal', { pct: pctTxt1 })}</span>
              <span>{g.targetDate ? `${t('panel.deadline')}: ${fmtDate(g.targetDate)}` : t('panel.noDeadline')}</span>
            </div>
            {contribRow}
          </Card>
        );
      }
      return (
        <Card title={g.name} action={action}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <Ring ratio={ratio} color="var(--accent)" size={96} />
            <div style={{ minWidth: 0 }}>
              <div className="fx-big" style={{ fontSize: 24 }}>{money(cur)}</div>
              <div className="fx-label">{t('panel.ofTarget', { value: money(g.targetCents) })}</div>
              <div className="fx-label" style={{ marginTop: 6 }}>{left > 0 ? t('panel.remaining', { value: money(left) }) : t('panel.goalReached')}</div>
              <div className="fx-label">{g.targetDate ? `${t('panel.deadline')}: ${fmtDate(g.targetDate)}` : t('panel.noDeadline')}</div>
            </div>
          </div>
          {contribRow}
        </Card>
      );
    }

    if (wKind === 'account' || wKind === 'accountbar') {
      const a = accounts.find((x) => x.id === wRef);
      if (!a) return null;
      const bal = balOf(a);
      const mine = txsOfAccount(txsAsOf, a.id, accounts);
      if (a.type === 'debt') {
        const owed = Math.max(bal, 0);
        const total = a.initialBalanceCents;
        const paid = Math.max(0, total - owed);
        const payments = mine.filter((x) => x.type === 'expense').length + transfersAsOf.filter((x) => x.toAccountId === a.id).length;
        const src = suggestedSource(accounts, a.id);
        const abate = async () => {
          const cents = parseMoneyToCents(contrib['abate:' + a.id] ?? '');
          if (!src || cents === null || cents <= 0) return;
          try {
            await addTransfer(db, { fromAccountId: src.id, toAccountId: a.id, amountCents: cents, date: todayISO(), note: '', categoryId: contrib['abatecat:' + a.id] || null });
            setContrib((c) => ({ ...c, ['abate:' + a.id]: '' }));
            setTransfers(await loadTransfers(db));
          } catch { /* moedas diferentes ou valor inválido: ignora */ }
        };
        const abateRow = src && owed > 0 && (
          <div className="fx-inline" style={{ marginTop: 12 }}>
            <input className="fx-input" inputMode="decimal" placeholder={t('panel.abatePlaceholder', { from: src.name })} value={contrib['abate:' + a.id] ?? ''}
              onChange={(e) => setContrib((c) => ({ ...c, ['abate:' + a.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') abate(); }} />
            <CategorySelect cats={cats} ariaLabel={t('accounts.category')} value={contrib['abatecat:' + a.id] ?? ''} emptyLabel={t('accounts.noCategory')}
              onChange={(v) => setContrib((c) => ({ ...c, ['abatecat:' + a.id]: v }))} />
            <button type="button" className="fx-btn primary" onClick={abate}>{t('accounts.abate')}</button>
          </div>
        );
        const action = styleSwitch(id, 'account:' + a.id, 'accountbar:' + a.id) ?? seeAll('/contas', t('accounts.title'));
        if (wKind === 'accountbar') {
          const r = total > 0 ? paid / total : 0;
          const pctTxt1 = new Intl.NumberFormat(settings.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(r * 100);
          return (
            <Card title={a.name} action={action} className="fx-barcard">
              <div className="fx-bar-big">{money(owed)}</div>
              <div className="fx-bar-sub">{t('panel.owed')} · {t('panel.paidOff', { value: money(paid), total: money(total) })} · {t('panel.payments', { count: payments })}</div>
              <SegBar ratio={r} tone="amber" label={a.name} />
              <div className="fx-bar-foot"><span>{t('panel.pctPaid', { pct: pctTxt1 })}</span><span>{owed > 0 ? t('panel.remaining', { value: money(owed) }) : t('panel.goalReached')}</span></div>
              {abateRow}
            </Card>
          );
        }
        return (
          <Card title={a.name} action={action}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <Ring ratio={total > 0 ? paid / total : 0} color="var(--amber)" size={96} />
              <div style={{ minWidth: 0 }}>
                <div className="fx-label">{t('panel.owed')}</div>
                <div className="fx-big" style={{ fontSize: 24 }}>{money(owed)}</div>
                <div className="fx-label" style={{ marginTop: 6 }}>{t('panel.paidOff', { value: money(paid), total: money(total) })}</div>
                <div className="fx-label">{t('panel.payments', { count: payments })}</div>
              </div>
            </div>
            {abateRow}
          </Card>
        );
      }
      const inc = mine.filter((x) => x.type === 'income' && x.date.startsWith(prefix)).reduce((sum, x) => sum + x.amountCents, 0)
        + transfers.filter((x) => x.toAccountId === a.id && x.date.startsWith(prefix)).reduce((sum, x) => sum + x.amountCents, 0);
      const out = mine.filter((x) => x.type === 'expense' && x.date.startsWith(prefix)).reduce((sum, x) => sum + x.amountCents, 0)
        + transfers.filter((x) => x.fromAccountId === a.id && x.date.startsWith(prefix)).reduce((sum, x) => sum + x.amountCents, 0);
      return (
        <Card title={a.name} action={seeAll('/contas', t('accounts.title'))}>
          <div className="fx-label">{t('accounts.type_' + a.type)}{a.id === defId ? ` · ${t('accounts.default')}` : ''}</div>
          <div className={'fx-big' + (bal < 0 ? ' fx-neg' : '')} style={{ margin: '6px 0 12px' }}>{money(bal)}</div>
          <div className="fx-stat"><span>{t('panel.inPeriod')}</span><span className="fx-num fx-pos">+{money(inc)}</span></div>
          <div className="fx-stat"><span>{t('panel.outPeriod')}</span><span className="fx-num">−{money(out)}</span></div>
        </Card>
      );
    }

    switch (id) {
      case 'goals':
        return (
          <Card title={t('panel.financialGoals')} action={seeAll('/metas', t('panel.seeAll'))}>
            {activeGoals.length === 0 ? (
              <div className="fx-empty">
                {t('panel.noGoals')}<br />
                <Link to="/metas" className="fx-btn" style={{ marginTop: 12 }}>{t('panel.createGoal')}</Link>
              </div>
            ) : (
              <div className="fx-list">
                {activeGoals.map((g, i) => (
                  <div key={g.id} className="fx-item">
                    <Ring ratio={g.targetCents > 0 ? currentOf(g) / g.targetCents : 0} color={goalColors[i % 3]} />
                    <div className="fx-item-main">
                      <b>{g.name}</b>
                      <span>{g.targetDate ? `${t('panel.deadline')}: ${fmtDate(g.targetDate)}` : t('panel.noDeadline')}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="fx-label">{t('panel.goal')}</div>
                      <div className="fx-num" style={{ fontSize: 13.5 }}>{money(g.targetCents)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      case 'budget':
        return (
          <Card title={t('panel.budgetUsage')} action={seeAll('/orcamentos', t('panel.manageBudgets'))}>
            {budgetLimit === 0 ? (
              <div className="fx-muted" style={{ fontSize: 13 }}>{period === 'year' ? t('panel.budgetEmptyYear', { year }) : t('panel.budgetEmpty')}</div>
            ) : (
              <>
                <Meter ratio={budgetUsed / budgetLimit} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span className="fx-muted">{t('panel.budgetSpentOf', { spent: money(budgetUsed), limit: money(budgetLimit) })}</span>
                  <span className={'fx-num' + (budgetUsed > budgetLimit ? ' fx-neg' : '')}>{Math.round((budgetUsed / budgetLimit) * 100)}%</span>
                </div>
              </>
            )}
          </Card>
        );
      case 'summary':
        return (
          <Card title={t('panel.summary')}>
            <div className="fx-stat"><span>{t('panel.dailyAverage')}</span><span className="fx-num">{money(avgDay)}</span></div>
            <div className="fx-stat"><span>{t('panel.expenseCount')}</span><span className="fx-num">{kpis.expenseCount}</span></div>
            <div className="fx-stat"><span>{t('panel.largestExpense')}</span><span className="fx-num">{money(kpis.largestExpenseCents)}</span></div>
            <div className="fx-stat"><span>{t('panel.salaryInPeriod')}</span><span className="fx-num">{money(salaryCents)}</span></div>
          </Card>
        );
      case 'overview':
        return (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{t('panel.overview')}</h2>
                <div className="fx-big" style={{ marginTop: 8 }}>{money(yearSpent)}</div>
                <div className="fx-label" style={{ marginTop: 2 }}>{t('panel.spentThisYear', { year })}</div>
              </div>
              <div className="fx-legend">
                <span><i className="fx-dot" style={{ background: 'var(--accent)' }} />{t('panel.earning')}</span>
                <span><i className="fx-dot" style={{ background: 'var(--teal)' }} />{t('panel.spending')}</span>
              </div>
            </div>
            <OverviewChart series={series} money={money} t={t}
              upTo={period === 'month' ? month - 1 : year < now.getFullYear() ? 11 : year === now.getFullYear() ? now.getMonth() : 0} />
          </Card>
        );
      case 'categories':
        return (
          <Card title={t('panel.allExpenses')}>
            {catItems.length === 0
              ? <div className="fx-empty">{t('panel.noTransactions')}</div>
              : <ExpensesDonut items={catItems} total={spent} money={money} t={t} />}
          </Card>
        );
      case 'calendar':
        return <DailyCalendar txs={accTxs} settings={settings} money={money} t={t} selYear={year} selMonth={month} period={period} onPick={pickMonth} />;
      case 'recent':
        return (
          <Card title={t('panel.recentTransactions')} action={seeAll('/transacoes', t('panel.seeAll'))}>
            {recent.length === 0 ? (
              <div className="fx-empty">{t('panel.noTransactions')}</div>
            ) : (
              <div className="fx-list">
                {recent.map((tx, i) => {
                  const c = catById.get(tx.categoryId);
                  const label = tx.description || catName(c);
                  return (
                    <div key={tx.id} className="fx-item">
                      <span className="fx-avatar" style={{ background: catColor(c, i) }}>{label.charAt(0).toUpperCase()}</span>
                      <div className="fx-item-main">
                        <b>{label}</b>
                        <span>{catName(c)} · {fmtDate(tx.date)}</span>
                      </div>
                      <span className={'fx-num ' + (tx.type === 'income' ? 'fx-pos' : '')} style={{ fontSize: 13.5 }}>
                        {tx.type === 'income' ? '+' : '−'}{money(tx.amountCents)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      case 'accounts':
        return (
          <Card title={t('panel.w_accounts')} action={seeAll('/contas', t('accounts.title'))}>
            <div className="fx-label">{t('accounts.netWorth')}</div>
            <div className="fx-big" style={{ margin: '4px 0 12px' }}>{money(netWorthCents(accounts, txsAsOf, salaryToDate, transfersAsOf))}</div>
            <div className="fx-list">
              {accounts.map((a) => (
                <div key={a.id} className="fx-item">
                  <span className="fx-avatar" style={{ background: a.type === 'savings' ? 'var(--teal)' : a.type === 'debt' ? 'var(--amber)' : 'var(--accent)', color: '#fff' }}><Ic d={typeIcon[a.type]} size={16} /></span>
                  <div className="fx-item-main"><b>{a.name}</b><span>{t('accounts.type_' + a.type)}</span></div>
                  <span className={'fx-num' + (balOf(a) < 0 ? ' fx-neg' : '')}>{money(balOf(a))}</span>
                </div>
              ))}
            </div>
          </Card>
        );
      case 'forecast': {
        const day = elapsedDays;
        const dim = daysInPeriod;
        const spentNow = spent;
        const projected = day > 0 ? Math.round((spentNow / day) * dim) : spentNow;
        const monthIncome = income;
        return (
          <Card title={t('panel.w_forecast')}>
            <div className="fx-label">{t('panel.forecastProjected')}</div>
            <div className="fx-big" style={{ margin: '4px 0 2px' }}>{money(projected)}</div>
            <div className="fx-label">{t('panel.forecastSpent', { value: money(spentNow), day, days: dim })}</div>
            <Meter ratio={monthIncome > 0 ? projected / monthIncome : null} />
            <div className="fx-stat"><span>{t('panel.forecastSavings')}</span>
              <span className={'fx-num' + (monthIncome - projected < 0 ? ' fx-neg' : ' fx-pos')}>{monthIncome > 0 ? money(monthIncome - projected) : '—'}</span></div>
          </Card>
        );
      }
      case 'last7': {
        const days = Array.from({ length: 7 }, (_, i) => {
          const end = new Date(asOf + 'T00:00:00');
          const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (6 - i));
          const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const total = accTxs.filter((x) => x.type === 'expense' && x.date === key).reduce((sum, x) => sum + x.amountCents, 0);
          return { label: cap(d.toLocaleDateString(lang, { weekday: 'short' }).replace('.', '')).slice(0, 3), total };
        });
        const max = Math.max(1, ...days.map((d) => d.total));
        const sum = days.reduce((a, d) => a + d.total, 0);
        return (
          <Card title={t('panel.w_last7')}>
            <div className="fx-big" style={{ fontSize: 24 }}>{money(sum)}</div>
            <div className="fx-label">{t('panel.last7Avg', { value: money(Math.round(sum / 7)) })}</div>
            <div className="fx-minibars" role="img" aria-label={t('panel.w_last7')}>
              {days.map((d, i) => (
                <div key={i} title={money(d.total)}>
                  <i style={{ height: `${Math.max(4, (d.total / max) * 100)}%`, background: i === 6 ? 'var(--accent)' : 'var(--track)' }} />
                  <em>{d.label}</em>
                </div>
              ))}
            </div>
          </Card>
        );
      }
      case 'topExpenses': {
        const top = periodTx.filter((x) => x.type === 'expense').sort((a, b) => b.amountCents - a.amountCents).slice(0, 5);
        return (
          <Card title={t('panel.w_topExpenses')} action={seeAll('/transacoes', t('panel.seeAll'))}>
            {top.length === 0 ? <div className="fx-empty">{t('panel.noTransactions')}</div> : (
              <div className="fx-list">
                {top.map((tx, i) => {
                  const c = catById.get(tx.categoryId);
                  const label = tx.description || catName(c);
                  return (
                    <div key={tx.id} className="fx-item">
                      <span className="fx-avatar" style={{ background: catColor(c, i) }}>{i + 1}</span>
                      <div className="fx-item-main"><b>{label}</b><span>{catName(c)} · {fmtDate(tx.date)}</span></div>
                      <span className="fx-num" style={{ fontSize: 13.5 }}>{money(tx.amountCents)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      }
      case 'upcoming': {
        const next = [...recurrings].sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 5);
        return (
          <Card title={t('panel.upcomingRecurring')} action={seeAll('/metas', t('panel.seeAll'))}>
            {next.length === 0 ? <div className="fx-empty">{t('panel.noUpcoming')}</div> : (
              <div className="fx-list">
                {next.map((r) => (
                  <div key={r.id} className="fx-item">
                    <span className="fx-avatar"><Ic d={ICON.repeat} size={16} /></span>
                    <div className="fx-item-main"><b>{r.description}</b><span>{fmtDate(r.nextDate)} · {t('goals.' + r.frequency)}</span></div>
                    <span className="fx-num" style={{ fontSize: 13.5 }}>{money(r.amountCents)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      }
      case 'checklist': {
        const steps = [
          { done: salaries.length > 0, label: t('panel.checkSalary'), to: '/salarios' },
          { done: txs.length > 0, label: t('panel.checkTx'), to: '/transacoes' },
          { done: budgets.length > 0, label: t('panel.checkBudget'), to: '/orcamentos' },
          { done: goals.length > 0, label: t('panel.checkGoal'), to: '/metas' },
          { done: accounts.length > 1, label: t('panel.checkAccount'), to: '/contas' },
        ];
        const n = steps.filter((x) => x.done).length;
        return (
          <Card title={t('panel.w_checklist')} action={<span className="fx-chip">{n}/{steps.length}</span>}>
            <Meter ratio={n / steps.length} />
            <div className="fx-list">
              {steps.map((st) => (
                <Link key={st.to} to={st.to} className="fx-item fx-check">
                  <span className={'fx-tick' + (st.done ? ' on' : '')}>{st.done && <Ic d={ICON.check} size={13} />}</span>
                  <div className="fx-item-main"><b style={st.done ? { color: 'var(--muted)', textDecoration: 'line-through' } : undefined}>{st.label}</b></div>
                </Link>
              ))}
            </div>
          </Card>
        );
      }
      default:
        return null;
    }
  };

  const galleryItems: Array<{ id: string; title: string; sub: string; group: string }> = [
    ...STATIC_WIDGETS.map((id) => ({ id, title: t('panel.w_' + id), sub: t('panel.wd_' + id), group: t('panel.widgetsTitle') })),
    ...goals.flatMap((g) => [
      { id: 'goal:' + g.id, title: g.name, sub: t('panel.wd_goal'), group: t('goals.title') },
      { id: 'goalbar:' + g.id, title: g.name, sub: t('panel.wd_goalBar'), group: t('goals.title') },
    ]),
    ...accounts.flatMap((a) => [
      { id: 'account:' + a.id, title: a.name, sub: t('panel.wd_account'), group: t('accounts.title') },
      ...(a.type === 'debt' ? [{ id: 'accountbar:' + a.id, title: a.name, sub: t('panel.wd_debtBar'), group: t('accounts.title') }] : []),
    ]),
  ].filter((x) => !placed.has(x.id) && !placed.has(twinOf(x.id)));

  return (
    <div className="fx-page">
      <header className="fx-head">
        <div>
          <h1>{t('panel.title')}</h1>
          <p data-testid="period-label">{period === 'month' ? t('panel.showingMonth', { period: periodLabel }) : t('panel.showingYear', { year })}</p>
        </div>
        <div className="fx-head-actions">
          <div className="fx-seg" role="group" aria-label={t('panel.period')}>
            <button type="button" className={period === 'month' ? 'on' : ''} aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>{t('panel.periodMonth')}</button>
            <button type="button" className={period === 'year' ? 'on' : ''} aria-pressed={period === 'year'} onClick={() => setPeriod('year')}>{t('panel.periodYear')}</button>
          </div>
          <div className="fx-periodnav">
            <button type="button" className="fx-round sm" onClick={() => stepPeriod(-1)} aria-label={period === 'month' ? t('panel.prevMonth') : t('panel.prevYear')} data-testid="period-prev"><Ic d="M15 6l-6 6 6 6" size={15} /></button>
            {period === 'month' && (
              <PickMenu<number> value={selM} onChange={setSelM} label={t('panel.month')} testId="period-month" compact
                options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: cap(new Date(2026, i, 1).toLocaleDateString(lang, { month: 'long' })) }))} />
            )}
            <PickMenu<number> value={selY} onChange={setSelY} label={t('panel.year')} testId="period-year" compact
              options={yearOptions.map((y) => ({ value: y, label: String(y) }))} />
            <button type="button" className="fx-round sm" onClick={() => stepPeriod(1)} aria-label={period === 'month' ? t('panel.nextMonth') : t('panel.nextYear')} data-testid="period-next"><Ic d={ARROW} size={15} /></button>
          </div>
          <AccountSwitch accounts={accounts} active={active} onChange={setActive} />
          <button type="button" className={'fx-btn' + (editing ? ' on' : '')} aria-pressed={editing} onClick={() => setEditing(!editing)}>
            <Ic d={editing ? 'M5 12l5 5 9-10' : 'M4 6h16M4 12h16M4 18h10'} size={15} /> {editing ? t('panel.done') : t('panel.customize')}
          </button>
          <Link to="/transacoes" className="fx-btn primary"><Ic d="M12 5v14M5 12h14" /> {t('panel.addExpense')}</Link>
        </div>
      </header>

      <div className="fx-kpis">
        <Kpi label={t('panel.expenses')} color="#4f8ff0" icon="M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2zM16 14h.01"
          value={money(spent)} pct={pctTxt(pctSpent)} pctTone={pctSpent !== null && pctSpent > 1 ? 'bad' : 'neutral'}
          sub={<>
            {pctSpent === null ? t('panel.noIncome') : t('panel.kpiExpensesSub')}
            {deltaSpent !== null && (
              <b className={deltaSpent > 0 ? 'fx-neg' : 'fx-pos'} style={{ marginLeft: 6, fontWeight: 600 }}>
                {deltaSpent > 0 ? '↑' : '↓'} {Math.abs(Math.round(deltaSpent * 100))}% {t('panel.vsPrevious')}
              </b>
            )}
          </>} />
        <Kpi label={t('panel.savings')} color="#2fbf8a" icon="M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01"
          value={savings === null ? '—' : money(savings)} pct={pctTxt(savings === null || income === 0 ? null : savings / income)}
          pctTone={savings !== null && savings < 0 ? 'bad' : 'good'}
          sub={savings === null ? t('panel.noIncome') : t('panel.kpiSavingsSub')} />
        <Kpi label={t('panel.income')} color="#8b6cf0" icon="M12 3v18M7 8l5-5 5 5M5 21h14"
          value={money(income)}
          sub={t('panel.kpiIncomeSub', { salary: money(salaryCents), extras: money(extrasCents) })} />
        <Kpi label={t('panel.topCategory')} color="#e0a53a" icon="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"
          value={catItems[0] ? catItems[0].name : '—'} pct={catItems[0] && spent > 0 ? pctTxt(catItems[0].cents / spent) : null}
          sub={catItems[0] ? t('panel.kpiTopSub', { value: money(catItems[0].cents) }) : t('panel.noTransactions')} />
      </div>

      {editing && (
        <div className="fx-editbar" role="status">
          <span>{t('panel.editHint')}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="fx-btn" onClick={() => setLayout(DEFAULT_LAYOUT.map((c) => [...c]))}>{t('panel.resetLayout')}</button>
          <button type="button" className="fx-btn primary" onClick={() => setGallery(true)}><Ic d="M12 5v14M5 12h14" size={15} /> {t('panel.addWidget')}</button>
        </div>
      )}

      <WidgetGrid
        layout={layout.map((c) => c.filter(widgetValid))}
        editing={editing}
        render={renderWidget}
        labelOf={widgetLabel}
        onMove={(id, col, before) => setLayout(moveWidget(layout, id, col, before))}
        onRemove={(id) => setLayout(removeWidget(layout, id))}
        onNudge={(id, dir) => setLayout(nudgeWidget(layout, id, dir))}
      />

      <Sheet open={gallery} onClose={() => setGallery(false)} title={t('panel.addWidget')} wide>
        {(
          ['panel.widgetsTitle', 'goals.title', 'accounts.title'].map((gk) => {
            const rows = galleryItems.filter((x) => x.group === t(gk));
            if (rows.length === 0 && gk === 'goals.title') {
              return (
                <div key={gk} style={{ marginBottom: 14 }}>
                  <div className="fx-label" style={{ margin: '4px 0 6px' }}>{t(gk)}</div>
                  <div className="fx-item">
                    <div className="fx-item-main"><b>{goals.length === 0 ? t('panel.noGoals') : t('panel.allGoalsPlaced')}</b><span>{t('panel.goalWidgetHint')}</span></div>
                    {goals.length === 0 && <Link to="/metas" className="fx-btn"><Ic d="M12 5v14M5 12h14" size={14} /> {t('panel.createGoal')}</Link>}
                  </div>
                </div>
              );
            }
            if (rows.length === 0) return null;
            return (
              <div key={gk} style={{ marginBottom: 14 }}>
                <div className="fx-label" style={{ margin: '4px 0 6px' }}>{t(gk)}</div>
                <div className="fx-list">
                  {rows.map((x) => (
                    <div key={x.id} className="fx-item">
                      <div className="fx-item-main"><b>{x.title}</b><span>{x.sub}</span></div>
                      <button type="button" className="fx-btn" onClick={() => setLayout(addWidget(layout, x.id))}><Ic d="M12 5v14M5 12h14" size={14} /> {t('common.add')}</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </Sheet>
    </div>
  );
}

// Período do Painel lembrado durante a sessão (ao sair e voltar ao Painel mantém-se).
const PERIOD_KEY = 'wallet.dashPeriod';
function loadPeriod(): { period: Period; year: number; month: number } {
  const now = new Date();
  const def = { period: 'month' as Period, year: now.getFullYear(), month: now.getMonth() + 1 };
  try {
    const v = JSON.parse(sessionStorage.getItem(PERIOD_KEY) || 'null');
    if (v && (v.period === 'month' || v.period === 'year') && Number.isInteger(v.year) && v.month >= 1 && v.month <= 12) return v;
  } catch { /* sem storage */ }
  return def;
}
function savePeriod(v: { period: Period; year: number; month: number }): void {
  try { sessionStorage.setItem(PERIOD_KEY, JSON.stringify(v)); } catch { /* sem storage */ }
}
