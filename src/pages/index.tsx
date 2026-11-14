import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { monthlyTotals, totalsByCategory, type CategoryTotal } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings, localeForLanguage } from '../core/settings';
import type { AppSettings } from '../core/settings';
import { Transactions } from './Transactions';
import { Calendar } from './Calendar';
import { Salaries } from './Salaries';
import { Budgets } from './Budgets';
import { Goals } from './Goals';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PageTitle({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <h1 className="page-title">{t(titleKey)}</h1>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '•';
}

// SVG area/line chart of income vs net savings across 12 months (photo-style).
function IncomeChart({ months, t, settings }: { months: { income: number; expense: number }[]; t: (k: string) => string; settings: AppSettings }) {
  const W = 640, H = 260, PAD = 34;
  const maxVal = Math.max(1, ...months.flatMap((m) => [m.income, m.income - m.expense]));
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / 11;
  const y = (v: number) => H - PAD - (Math.max(0, v) / maxVal) * (H - 2 * PAD);

  const linePath = (key: 'income' | 'net') =>
    months.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(key === 'income' ? m.income : m.income - m.expense)}`).join(' ');
  const areaPath = (key: 'income' | 'net') => linePath(key) + ` L ${x(11)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;

  const peakIdx = months.reduce((best, m, i) => (m.income > months[best].income ? i : best), 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="line-chart" role="img" aria-label={t('panel.incomeAnalysis')}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const gy = H - PAD - f * (H - 2 * PAD);
        return (
          <g key={f}>
            <line x1={PAD} y1={gy} x2={W - PAD} y2={gy} stroke="rgba(255,255,255,0.07)" />
            <text x={PAD - 8} y={gy + 4} fontSize="10" fill="rgba(255,255,255,0.35)" textAnchor="end">
              {Math.round((maxVal * f) / 100)}k
            </text>
          </g>
        );
      })}
      <path d={areaPath('income')} fill="url(#gradIncome)" opacity="0.35" />
      <path d={linePath('income')} fill="none" stroke="#4f9dff" strokeWidth="2.5" />
      <path d={linePath('net')} fill="none" stroke="#e05aa0" strokeWidth="2.5" />
      {months[peakIdx].income > 0 && (
        <g>
          <circle cx={x(peakIdx)} cy={y(months[peakIdx].income)} r="4" fill="#fff" opacity="0.9" />
          <rect x={Math.min(W - PAD - 120, Math.max(PAD, x(peakIdx) - 60))} y={y(months[peakIdx].income) - 58} width="120" height="46" rx="10" fill="rgba(20,26,40,0.85)" stroke="rgba(255,255,255,0.12)" />
          <text x={Math.min(W - PAD - 60, Math.max(PAD + 60, x(peakIdx)))} y={y(months[peakIdx].income) - 43} fontSize="10" fill="rgba(255,255,255,0.5)" textAnchor="middle">
            {MONTH_NAMES[peakIdx]} {new Date().getFullYear()}
          </text>
          <text x={Math.min(W - PAD - 60, Math.max(PAD + 60, x(peakIdx)))} y={y(months[peakIdx].income) - 24} fontSize="15" fill="#fff" textAnchor="middle">
            {formatMoney(months[peakIdx].income, settings.currency, settings.language)}
          </text>
        </g>
      )}
      <defs>
        <linearGradient id="gradIncome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f9dff" />
          <stop offset="100%" stopColor="#e05aa0" />
        </linearGradient>
      </defs>
      {months.map((_, i) => (
        <text key={i} x={x(i)} y={H - 10} fontSize="10" fill="rgba(255,255,255,0.35)" textAnchor="middle">{MONTH_NAMES[i]}</text>
      ))}
    </svg>
  );
}

export function Panel() {
  const { t } = useTranslation();
  const [months, setMonths] = useState<{ income: number; expense: number }[]>([]);
  const [cats, setCats] = useState<CategoryTotal[]>([]);
  const [catColors, setCatColors] = useState<Map<string, string>>(new Map());
  const [recent, setRecent] = useState<{ description: string; date: string; amountCents: number; type: 'expense' | 'income'; color: string }[]>([]);
  const settings: AppSettings = loadSettings();

  useEffect(() => {
    const year = new Date().getFullYear();
    Promise.all([
      monthlyTotals(db, year),
      totalsByCategory(db, year, new Date().getMonth() + 1),
      db.transactions.filter((tr) => tr.deletedAt === null).toArray(),
      db.categories.toArray(),
    ]).then(([mt, catTotals, txs, categories]) => {
      setMonths(mt);
      setCats(catTotals);
      const colorOf = new Map(categories.filter((c) => c.deletedAt === null).map((c) => [c.id, c.color]));
      setCatColors(colorOf);
      setRecent(
        txs.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((tr) => ({
          description: tr.description,
          date: tr.date,
          amountCents: tr.amountCents,
          type: tr.type,
          color: colorOf.get(tr.categoryId) ?? '#9CA3AF',
        })),
      );
    });
  }, []);

  const totalIncome = months.reduce((s, m) => s + m.income, 0);
  const totalSpent = months.reduce((s, m) => s + m.expense, 0);
  const savings = totalIncome - totalSpent;
  const savingsPct = totalIncome > 0 ? Math.max(0, Math.min(100, Math.round((savings / totalIncome) * 100))) : 0;
  const spentPct = totalIncome > 0 ? Math.max(0, Math.min(100, Math.round((totalSpent / totalIncome) * 100))) : 0;
  const activeCats = cats.filter((c) => c.totalCents > 0).map((c) => ({ ...c, color: catColors.get(c.categoryId) ?? '#9CA3AF' }));

  return (
    <div className="dashboard">
      <section className="dash-grid">
        {/* Left: Income Analysis */}
        <article className="glass-card card-analysis">
          <header className="card-head">
            <span className="icon-sq">📊</span>
            <h2>{t('panel.incomeAnalysis')}</h2>
          </header>
          <div className="chart-legend">
            <span className="dot" style={{ background: '#4f9dff' }} /> {t('panel.income')}
            <span className="dot" style={{ background: '#e05aa0' }} /> {t('panel.net')}
          </div>
          <IncomeChart months={months} t={t} settings={settings} />
        </article>

        {/* Right column: KPI cards */}
        <aside className="kpi-col">
          <article className="glass-card kpi">
            <header className="card-head">
              <span className="icon-sq">💪</span>
              <h2>{t('panel.monthlySavings')}</h2>
            </header>
            <div className="kpi-value">{formatMoney(savings, settings.currency, settings.language)}</div>
            <div className="progress progress-blue"><span style={{ width: savingsPct + '%' }} /></div>
          </article>

          <article className="glass-card kpi">
            <header className="card-head">
              <span className="icon-sq">💙</span>
              <h2>{t('panel.monthlyExpenses')}</h2>
            </header>
            <div className="kpi-value">{formatMoney(totalSpent, settings.currency, settings.language)}</div>
            <div className="progress progress-pink"><span style={{ width: spentPct + '%' }} /></div>
          </article>

          <article className="glass-card assistant">
            <header className="card-head">
              <span className="icon-sq">✨</span>
              <h2>{t('panel.aiAssistant')}</h2>
            </header>
            <p>{t('panel.aiHint')}</p>
          </article>
        </aside>

        {/* Bottom row */}
        <article className="glass-card card-recent">
          <header className="card-head">
            <span className="icon-sq">💙</span>
            <h2>{t('panel.recent')}</h2>
            <a className="see-all" href="/transactions">{t('panel.seeAll')}</a>
          </header>
          {recent.length === 0 ? (
            <p className="muted">{t('common.noData')}</p>
          ) : (
            <ul className="tx-list">
              {recent.map((tr, i) => (
                <li key={i}>
                  <span className="avatar" style={{ background: tr.color }}>{initials(tr.description)}</span>
                  <div>
                    <strong>{tr.description}</strong>
                    <small>{new Date(tr.date).toLocaleDateString(localeForLanguage(settings.language))}</small>
                  </div>
                  <span className={tr.type === 'income' ? 'amt-pos' : 'amt-neg'}>
                    {tr.type === 'income' ? '+' : '-'}{formatMoney(tr.amountCents, settings.currency, settings.language)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="glass-card card-budget">
          <header className="card-head">
            <span className="icon-sq">💙</span>
            <h2>{t('panel.budgetUsage')}</h2>
          </header>
          {activeCats.length === 0 ? (
            <p className="muted">{t('common.noData')}</p>
          ) : (
            <>
              <div className="donut-wrap">
                <svg viewBox="0 0 120 120" className="donut">
                  {(() => {
                    const total = activeCats.reduce((s, c) => s + c.totalCents, 0);
                    let acc = 0;
                    const r = 45, cx = 60, cy = 60;
                    return activeCats.map((c) => {
                      const frac = c.totalCents / total;
                      const a1 = acc * 2 * Math.PI - Math.PI / 2;
                      acc += frac;
                      const a2 = acc * 2 * Math.PI - Math.PI / 2;
                      const large = frac > 0.5 ? 1 : 0;
                      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
                      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
                      return <path key={c.categoryId} d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`} fill="none" stroke={c.color} strokeWidth="16" />;
                    });
                  })()}
                </svg>
              </div>
              <ul className="legend">
                {activeCats.slice(0, 6).map((c) => (
                  <li key={c.categoryId}><span className="dot" style={{ background: c.color }} /> {c.name}</li>
                ))}
              </ul>
            </>
          )}
        </article>
      </section>
    </div>
  );
}

export { Transactions, Calendar, Salaries, Budgets, Goals };
