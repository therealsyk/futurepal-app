import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Category, Transaction, Transfer } from '../db/database';
import { buildCalendarGrid, dailyExpenseTotals, weekdayLabels, activeCategories, listGoals, listGroups } from '../core/finance';
import { accountBalanceCents, ensureDefaultAccount, listAccounts, loadTransfers, salariesUntil } from '../core/accounts';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { currencySymbol } from '../core/currencies';
import { useAuth } from '../auth/AuthContext';
import { Ic, ICON, catLabel } from '../ui/fx';

// Início no telemóvel: calendário do mês com o gasto de cada dia, últimas transações e contas.
const SPARK = 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z';
const GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z';

const pad = (n: number) => String(n).padStart(2, '0');

export function MobileHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const settings = loadSettings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [byDay, setByDay] = useState<Record<number, number>>({});
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [allTx, setAllTx] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [salaryCents, setSalaryCents] = useState(0);
  const [hasGoal, setHasGoal] = useState(true);
  const [hasGroup, setHasGroup] = useState(true);

  useEffect(() => {
    dailyExpenseTotals(db, year, month, settings.currency).then((r) => setByDay(r.byDay)).catch(() => {});
  }, [year, month, settings.currency]);

  useEffect(() => {
    (async () => {
      await ensureDefaultAccount(db, settings.currency, t('accounts.mainName'));
      const txs = (await db.transactions.toArray()).filter((x) => x.deletedAt === null);
      setAllTx(txs);
      setRecent([...txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5));
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
  const monthLabel = new Intl.DateTimeFormat(settings.language, { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  const isToday = (d: number) => d === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear();
  const money = (c: number, cur = settings.currency) => formatMoney(c, cur, settings.language);
  // Valor curto na célula do calendário (sem cêntimos): 0 €, 12 €, 1,2 mil €
  const short = (c: number) => new Intl.NumberFormat(settings.language, { style: 'currency', currency: settings.currency, maximumFractionDigits: 0, notation: c >= 1_000_000 ? 'compact' : 'standard' }).format(Math.round(c / 100));
  const shift = (d: number) => {
    let m = month + d, y = year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };

  const name = (auth.user?.user_metadata as { name?: string } | undefined)?.name || auth.user?.email?.split('@')[0] || t('common.appName');
  const initials = name.slice(0, 2).toUpperCase();
  const home = accounts.filter((a) => a.showOnHome);

  return (
    <div className="fx-page mh">
      <header className="mh-head">
        <span className="mh-avatar" aria-hidden="true">{initials}</span>
        <div className="mh-who">
          <b>{name}</b>
          <small>{auth.user?.email ?? t('settings2.localMode')}</small>
        </div>
        <button type="button" className="mh-icon" onClick={() => navigate('/definicoes?ai=1')} aria-label={t('ai.rowTitle')}><Ic d={SPARK} size={22} /></button>
        <button type="button" className="mh-icon" onClick={() => navigate('/definicoes')} aria-label={t('nav.settings')}><Ic d={GEAR} size={22} /></button>
      </header>

      <section className="mh-card mh-cal" aria-label={monthLabel}>
        <div className="mh-monthnav">
          <button type="button" className="mh-arrow" onClick={() => shift(-1)} aria-label={t('calendar.prevMonth')}><Ic d="M19 12H5M11 6l-6 6 6 6" size={22} /></button>
          <h2>{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</h2>
          <button type="button" className="mh-arrow" onClick={() => shift(1)} aria-label={t('calendar.nextMonth')}><Ic d="M5 12h14M13 6l6 6-6 6" size={22} /></button>
        </div>
        <div className="mh-week" aria-hidden="true">{weekdays.map((w) => <span key={w}>{w.replace('.', '').slice(0, 3).toUpperCase()}</span>)}</div>
        <div className="mh-grid">
          {cells.map((d, i) => d === 0 ? <span key={'e' + i} className="mh-day empty" /> : (
            <Link key={d} to={`/dia/${year}-${pad(month)}-${pad(d)}`} className={'mh-day' + (isToday(d) ? ' today' : '') + ((byDay[d] ?? 0) > 0 ? ' spent' : '')}>
              <span>{d}</span>
              <b>{short(byDay[d] ?? 0)}</b>
            </Link>
          ))}
        </div>
        <Link to="/visao-mensal" className="mh-more">{t('mobile.monthly')} <Ic d={ICON.right} size={18} /></Link>
      </section>

      <h2 className="mh-title">{t('mobile.latest')}</h2>
      <section className="mh-card">
        {recent.length === 0 ? (
          <div className="mh-empty"><Ic d={ICON.wallet} size={32} /><p>{t('onboard.noTx')}</p></div>
        ) : (
          <ul className="mh-tx">
            {recent.map((tx) => {
              const c = cats.find((x) => x.id === tx.categoryId);
              return (
                <li key={tx.id}>
                  <span className="mh-dot" style={{ background: c?.color ?? 'var(--muted)' }} />
                  <span className="mh-tx-main"><b>{tx.description || (c ? catLabel(t, c) : '')}</b><small>{c ? catLabel(t, c) : ''} · {tx.date.slice(8, 10)}/{tx.date.slice(5, 7)}</small></span>
                  <b className={tx.type === 'income' ? 'pos' : ''}>{(tx.type === 'income' ? '+' : '-') + money(tx.amountCents, tx.currency)}</b>
                </li>
              );
            })}
            <li className="mh-seeall"><Link to="/transacoes">{t('panel.seeAll')}</Link></li>
          </ul>
        )}
      </section>

      <h2 className="mh-title">{t('nav.accounts')}</h2>
      {home.map((a) => (
        <section key={a.id} className="mh-card mh-acc">
          <span className="ob-coin">{currencySymbol(a.currency, settings.language)}</span>
          <div className="mh-acc-main">
            <b>{a.name}</b>
            <strong>{money(accountBalanceCents(a, allTx, accounts, salaryCents, transfers), a.currency)}</strong>
          </div>
          <span className={'mh-badge ' + a.type}>{t('accounts.type_' + a.type)}</span>
          {a.isDefault && <span className="mh-chip">{t('mobile.default')}</span>}
          <button type="button" className="mh-edit" onClick={() => navigate('/contas')} aria-label={t('common.edit')}><Ic d={ICON.edit} size={18} /></button>
        </section>
      ))}

      {!hasGroup && (
        <section className="mh-card mh-promo">
          <h3>{t('mobile.groupTitle')}</h3>
          <p>{t('mobile.groupSub')}</p>
          <button type="button" className="ob-cta" onClick={() => navigate('/metas')}>+ {t('mobile.groupTitle')}</button>
        </section>
      )}
      {!hasGoal && (
        <section className="mh-card mh-promo">
          <span className="mh-target" aria-hidden="true"><Ic d={ICON.target} size={56} /></span>
          <h3>{t('onboard.goalTitle')}</h3>
          <p>{t('onboard.goalSub')}</p>
          <button type="button" className="ob-cta" onClick={() => navigate('/metas')}>+ {t('onboard.createGoal')}</button>
        </section>
      )}
    </div>
  );
}
