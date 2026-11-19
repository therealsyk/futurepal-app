import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Category, Transaction, Transfer } from '../db/database';
import { buildCalendarGrid, dailyExpenseTotals, weekdayLabels, activeCategories, listGoals, listGroups, periodSummary, type PeriodSummary } from '../core/finance';
import { accountBalanceCents, ensureDefaultAccount, listAccounts, loadTransfers, salariesUntil } from '../core/accounts';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { useAuth } from '../auth/AuthContext';
import { Ic, ICON, CatIcon, catLabel } from '../ui/fx';
import { openTutorial } from '../ui/MobileTutorial';
import { hasFeature } from '../core/plan';
import { monthForecast } from '../core/premium';
import { Sponsored } from '../ui/Sponsored';

// Início no telemóvel (variante): resumo do mês num cartão de destaque, ações rápidas,
// mapa de calor dos gastos diários, categorias onde se gasta mais, últimas transações agrupadas
// por dia e contas num carrossel horizontal.
const SPARK = 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z';
const GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z';
const CAL = 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4';
const PIE = 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z';
const GRID = 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function MobileHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const settings = loadSettings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [byDay, setByDay] = useState<Record<number, number>>({});
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [allTx, setAllTx] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [salaryCents, setSalaryCents] = useState(0);
  const [hasGoal, setHasGoal] = useState(true);
  const [hasGroup, setHasGroup] = useState(true);

  const start = `${year}-${pad(month)}-01`;
  const end = iso(new Date(year, month, 0));

  useEffect(() => {
    dailyExpenseTotals(db, year, month, settings.currency).then((r) => setByDay(r.byDay)).catch(() => {});
    periodSummary(db, start, end).then(setSummary).catch(() => {});
  }, [year, month, settings.currency, start, end]);

  useEffect(() => {
    (async () => {
      await ensureDefaultAccount(db, settings.currency, t('accounts.mainName'));
      setAllTx((await db.transactions.toArray()).filter((x) => x.deletedAt === null));
      setCats(await activeCategories(db));
      setAccounts(await listAccounts(db));
      setTransfers(await loadTransfers(db));
      setSalaryCents(salariesUntil(await db.salaries.toArray(), now.getFullYear(), now.getMonth() + 1));
      setHasGoal((await listGoals(db)).length > 0);
      setHasGroup((await listGroups(db)).length > 0);
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cells = useMemo(() => buildCalendarGrid(year, month, settings.firstDayOfWeek), [year, month, settings.firstDayOfWeek]);
  const weekdays = useMemo(() => weekdayLabels(settings.language, settings.firstDayOfWeek), [settings.language, settings.firstDayOfWeek]);
  const monthName = new Intl.DateTimeFormat(settings.language, { month: 'long' }).format(new Date(year, month - 1, 1));
  const monthLabel = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;
  const isToday = (d: number) => d === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear();
  const money = (c: number, cur = settings.currency) => formatMoney(c, cur, settings.language);
  // Valor curto no dia do mapa (sem cêntimos): 12 €, 430 €, 1,2 mil €
  const short = (c: number) => new Intl.NumberFormat(settings.language, { style: 'currency', currency: settings.currency, maximumFractionDigits: 0, notation: c >= 100_000 ? 'compact' : 'standard' }).format(Math.round(c / 100));
  const shift = (d: number) => {
    let m = month + d, y = year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };

  // Mapa de calor: 5 níveis relativos ao dia com mais gasto do mês.
  const maxDay = Math.max(0, ...Object.values(byDay));
  const level = (c: number) => (c <= 0 || maxDay <= 0 ? 0 : Math.min(4, Math.ceil((c / maxDay) * 4)));
  const topDay = maxDay > 0 ? Number(Object.keys(byDay).find((k) => byDay[Number(k)] === maxDay)) : 0;

  // Categorias com mais despesa no mês mostrado.
  const topCats = useMemo(() => {
    const totals = new Map<string, number>();
    for (const tx of allTx) {
      if (tx.type !== 'expense' || tx.date < start || tx.date > end) continue;
      totals.set(tx.categoryId, (totals.get(tx.categoryId) ?? 0) + tx.amountCents);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([id, cents]) => ({ cat: cats.find((c) => c.id === id), cents }));
  }, [allTx, cats, start, end]);
  const catTotal = topCats.reduce((s, x) => s + x.cents, 0);

  // Últimas 6 transações agrupadas por data.
  const groups = useMemo(() => {
    const recent = [...allTx].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
    const out: Array<{ date: string; items: Transaction[] }> = [];
    for (const tx of recent) {
      const last = out[out.length - 1];
      if (last && last.date === tx.date) last.items.push(tx); else out.push({ date: tx.date, items: [tx] });
    }
    return out;
  }, [allTx]);
  const todayIso = iso(now);
  const yesterdayIso = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const dayHeading = (d: string) => d === todayIso ? t('mobile.today') : d === yesterdayIso ? t('mobile.yesterday')
    : new Intl.DateTimeFormat(settings.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00'));

  const name = (auth.user?.user_metadata as { name?: string } | undefined)?.name || auth.user?.email?.split('@')[0] || '';
  const home = accounts.filter((a) => a.showOnHome);
  const spent = summary?.totalSpentCents ?? 0;
  const income = summary?.incomeCents ?? 0;
  const pct = income > 0 ? Math.round((spent / income) * 100) : null;

  const quick: Array<{ label: string; d: string; to: string; main?: boolean }> = [
    { label: t('nav.transactions'), d: ICON.repeat, to: '/transacoes' },
    { label: t('nav.calendar'), d: CAL, to: '/calendario' },
    { label: t('mobile.quickBudgets'), d: PIE, to: '/orcamentos' },
    { label: t('mobile.quickPanel'), d: GRID, to: '/painel' },
  ];

  return (
    <div className="fx-page mv">
      <header className="mv-head">
        <div className="mv-hello">
          <h1>{name ? t('mobile.hello', { name }) : t('mobile.helloAnon')}</h1>
        </div>
        <button type="button" className="mv-sq" onClick={openTutorial} aria-label={t('tutorial.title')} data-testid="mv-help" data-tour="help"><Ic d="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2v.3M12 17.5h.01" size={20} /></button>
        <button type="button" className="mv-sq" onClick={() => navigate('/definicoes?ai=1')} aria-label={t('ai.rowTitle')}><Ic d={SPARK} size={20} /></button>
        <button type="button" className="mv-sq" onClick={() => navigate('/definicoes')} aria-label={t('nav.settings')}><Ic d={GEAR} size={20} /></button>
      </header>

      <section className="mv-hero" aria-label={monthLabel} data-tour="month">
        <div className="mv-hero-top">
          <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={t('calendar.prevMonth')}><Ic d={ICON.left} size={18} /></button>
          <span className="mv-month">{monthLabel}</span>
          <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={t('calendar.nextMonth')}><Ic d={ICON.right} size={18} /></button>
        </div>
        <small className="mv-hero-label">{t('mobile.spentMonth')}</small>
        <strong className="mv-hero-amount" data-testid="mv-spent">{money(spent)}</strong>
        <div className="mv-bar" role="img" aria-label={pct === null ? t('mobile.noIncome') : t('mobile.ofIncome', { pct })}>
          <i style={{ width: `${Math.min(100, pct ?? 0)}%` }} className={pct !== null && pct > 100 ? 'over' : ''} />
        </div>
        <small className="mv-hero-sub">{pct === null ? t('mobile.noIncome') : t('mobile.ofIncome', { pct })}</small>
        {(() => {
          const fc = monthForecast(spent, income, year, month);
          if (!fc) return null;
          return hasFeature('forecast')
            ? <p className="mv-forecast">{t('plus.forecast', { spend: money(fc.projectedSpendCents), bal: money(fc.projectedBalanceCents) })}</p>
            : <Link to="/plus" className="mv-forecast locked">{t('plus.forecastLocked')}</Link>;
        })()}
        <div className="mv-stats">
          <div><small>{t('mobile.incomeShort')}</small><b>{money(income)}</b></div>
          <div><small>{t('mobile.savingsShort')}</small><b className={(summary?.savingsCents ?? 0) < 0 ? 'neg' : 'pos'}>{income > 0 ? money(summary?.savingsCents ?? 0) : '—'}</b></div>
          <div><small>{t('mobile.perDay')}</small><b>{money(summary?.avgPerDayCents ?? 0)}</b></div>
        </div>
      </section>

      <nav data-tour="quick" className="mv-quick" aria-label={t('mobile.quickTitle')}>
        {quick.map((q) => (
          <Link key={q.to} to={q.to} className={'mv-q' + (q.main ? ' main' : '')}>
            <span><Ic d={q.d} size={22} /></span>
            {q.label}
          </Link>
        ))}
      </nav>

      <section className="mv-card" data-tour="map">
        <div className="mv-card-head">
          <h2>{t('mobile.heatTitle')}</h2>
          <Link to="/visao-mensal" className="mv-link">{t('mobile.monthly')} <Ic d={ICON.right} size={16} /></Link>
        </div>
        <p className="mv-hint">{t('mobile.heatHint')}</p>
        <div className="mv-week" aria-hidden="true">{weekdays.map((w) => <span key={w}>{w.replace('.', '').slice(0, 1).toUpperCase()}</span>)}</div>
        <div className="mv-heat">
          {cells.map((d, i) => d === 0 ? <span key={'e' + i} className="mv-hd empty" /> : (
            <Link key={d} to={`/dia/${year}-${pad(month)}-${pad(d)}`}
              className={`mv-hd l${level(byDay[d] ?? 0)}` + (isToday(d) ? ' today' : '')}
              aria-label={`${d} · ${money(byDay[d] ?? 0)}`}>
              <span>{d}</span>
              {(byDay[d] ?? 0) > 0 && <small>{short(byDay[d])}</small>}
            </Link>
          ))}
        </div>
        <div className="mv-heat-foot">
          <span>{topDay ? t('mobile.topDay', { day: topDay, amount: money(maxDay) }) : t('mobile.noSpend')}</span>
          <span className="mv-legend" aria-hidden="true">{t('mobile.heatLess')}<i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" />{t('mobile.heatMore')}</span>
        </div>
      </section>

      {topCats.length > 0 && (
        <section className="mv-card">
          <div className="mv-card-head"><h2>{t('mobile.topCats')}</h2><Link to="/painel" className="mv-link">{t('panel.seeAll')}</Link></div>
          <ul className="mv-cats">
            {topCats.map(({ cat, cents }, i) => (
              <li key={cat?.id ?? i}>
                {cat ? <CatIcon cat={cat} size={38} /> : <span className="mv-cat-ph" />}
                <div>
                  <span className="mv-cat-row"><b>{cat ? catLabel(t, cat) : '—'}</b><b>{money(cents)}</b></span>
                  <span className="mv-cat-bar"><i style={{ width: `${catTotal ? (cents / catTotal) * 100 : 0}%`, background: cat?.color ?? 'var(--accent)' }} /></span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mv-card">
        <div className="mv-card-head"><h2>{t('mobile.latest')}</h2>{groups.length > 0 && <Link to="/transacoes" className="mv-link">{t('panel.seeAll')}</Link>}</div>
        {groups.length === 0 ? (
          <div className="mv-empty">
            <span><Ic d={ICON.wallet} size={28} /></span>
            <p>{t('onboard.noTx')}</p>
            <Link to="/transacoes?nova=1" className="mv-pill">+ {t('mobile.quickNew')}</Link>
          </div>
        ) : groups.map((g) => (
          <div key={g.date} className="mv-txg">
            <h3>{dayHeading(g.date)}</h3>
            <ul>
              {g.items.map((tx) => {
                const c = cats.find((x) => x.id === tx.categoryId);
                return (
                  <li key={tx.id}>
                    {c ? <CatIcon cat={c} size={40} /> : <span className="mv-cat-ph" />}
                    <span className="mv-tx-main"><b>{tx.description || (c ? catLabel(t, c) : '')}</b>{c && tx.description && tx.description !== catLabel(t, c) && <small>{catLabel(t, c)}</small>}</span>
                    <b className={'mv-amt' + (tx.type === 'income' ? ' pos' : '')}>{(tx.type === 'income' ? '+' : '−') + money(tx.amountCents, tx.currency)}</b>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <div className="mv-card-head mv-out"><h2>{t('nav.accounts')}</h2><Link to="/contas" className="mv-link">{t('common.edit')}</Link></div>
      <div className="mv-accs" data-tour="accounts">
        {home.map((a) => (
          <button key={a.id} type="button" className={'mv-acc ' + a.type} onClick={() => navigate('/contas')}>
            <span className="mv-acc-top"><span className="mv-acc-type">{t('accounts.type_' + a.type)}</span>{a.isDefault && <span className="mv-acc-def">{t('mobile.default')}</span>}</span>
            <b>{a.name}</b>
            <strong>{money(accountBalanceCents(a, allTx, accounts, salaryCents, transfers), a.currency)}</strong>
          </button>
        ))}
        <button type="button" className="mv-acc add" onClick={() => navigate('/contas')} aria-label={t('nav.accounts')}><Ic d={ICON.plus} size={24} /></button>
      </div>

      {(!hasGoal || !hasGroup) && (
        <div className="mv-promos">
          {!hasGoal && (
            <button type="button" className="mv-promo" onClick={() => navigate('/metas')}>
              <span><Ic d={ICON.target} size={24} /></span>
              <b>{t('onboard.goalTitle')}</b>
              <small>{t('onboard.goalSub')}</small>
            </button>
          )}
          {!hasGroup && (
            <button type="button" className="mv-promo" onClick={() => navigate('/metas')}>
              <span><Ic d={ICON.folder} size={24} /></span>
              <b>{t('mobile.groupTitle')}</b>
              <small>{t('mobile.groupSub')}</small>
            </button>
          )}
        </div>
      )}
      <Sponsored place="MobileHome" />
    </div>
  );
}
