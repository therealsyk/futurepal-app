import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Transaction, Category } from '../db/database';
import { txsOfAccount } from '../core/accounts';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { Link } from 'react-router-dom';
import { catLabel, PageHead, Seg, MonthNav, EmptyState, AccountSwitch, Ic, ICON, useAccounts } from '../ui/fx';
import { Sponsored } from '../ui/Sponsored';

const PALETTE = ['#8b7cf6', '#5fd4c4', '#e58fd3', '#f5b85a', '#60a5fa', '#4ade9b', '#f87171', '#a78bfa', '#22d3ee', '#fb7185', '#eab308', '#9ca3af'];

function Donut({ slices, empty }: { slices: Array<{ id: string; label: string; value: number; color: string }>; empty: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 84, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <svg viewBox="0 0 220 220" width="100%" style={{ maxWidth: 260 }} role="img" aria-label="chart">
      <circle cx="110" cy="110" r={R} fill="none" stroke="var(--track)" strokeWidth="22" />
      {total > 0 && slices.map((s) => {
        const len = (s.value / total) * C;
        const el = <circle key={s.id} cx="110" cy="110" r={R} fill="none" stroke={s.color} strokeWidth="22" strokeDasharray={`${Math.max(len - 3, 0)} ${C - Math.max(len - 3, 0)}`} strokeDashoffset={-off} transform="rotate(-90 110 110)" />;
        off += len;
        return el;
      })}
      {total === 0 && <text x="110" y="116" textAnchor="middle" fill="var(--muted)" fontSize="15">{empty}</text>}
    </svg>
  );
}

export function Overview() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<'overview' | 'categories'>('overview');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const { accounts, active, setActive } = useAccounts();
  const [all, setAll] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);

  useEffect(() => {
    (async () => {
      setAll((await db.transactions.toArray()).filter((x) => x.deletedAt === null));
      setCats((await db.categories.toArray()).filter((c) => c.deletedAt === null));
    })().catch(() => {});
  }, []);

  const money = (c: number) => formatMoney(c, settings.currency, settings.language);
  const mine = useMemo(() => txsOfAccount(all, active, accounts), [all, active, accounts]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const p = `${year}-${String(i + 1).padStart(2, '0')}`;
    const rows = mine.filter((x) => x.date.startsWith(p));
    return { m: i + 1, income: rows.filter((x) => x.type === 'income').reduce((s, x) => s + x.amountCents, 0), expense: rows.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amountCents, 0) };
  }), [mine, year]);
  const cur = months[month - 1];
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const rows = mine.filter((x) => x.date.startsWith(prefix)).sort((a, b) => b.date.localeCompare(a.date));
  const maxBar = Math.max(1, ...months.map((x) => Math.max(x.income, x.expense)));

  const slices = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of rows.filter((r) => r.type === kind)) m.set(x.categoryId, (m.get(x.categoryId) ?? 0) + x.amountCents);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, value], i) => {
      const c = cats.find((k) => k.id === id);
      return { id, value, label: c ? catLabel(t, c) : '?', color: c?.color || PALETTE[i % PALETTE.length] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, kind, cats]);
  const sliceTotal = slices.reduce((s, x) => s + x.value, 0);

  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];
  const shift = (d: number) => {
    let m = month + d, y = year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };
  const dayLabel = (d: string) => new Intl.DateTimeFormat(settings.language, { day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00'));

  return (
    <div className="fx-page">
      <PageHead title={t('overview.title')} sub={t('overview.subtitle')}>
        <AccountSwitch accounts={accounts} active={active} onChange={setActive} />
        <Link to="/transacoes" className="fx-btn primary"><Ic d={ICON.plus} size={16} />{t('transactions.new')}</Link>
      </PageHead>

      <div className="fx-toolbar">
        <MonthNav label={`${monthNames[month - 1]} ${year}`} onPrev={() => shift(-1)} onNext={() => shift(1)} />
        <Seg value={tab} onChange={setTab} options={[{ id: 'overview', label: t('overview.tabOverview') }, { id: 'categories', label: t('overview.tabCategories') }]} />
      </div>

      <div className="fx-grid2">
        <div className="fx-col">
          <div className="fx-card">
            <div className="fx-card-head"><h2>{t('overview.last12')}</h2>
              <div className="fx-legend"><span><i className="fx-dot" style={{ background: 'var(--teal)' }} />{t('overview.incomes')}</span><span><i className="fx-dot" style={{ background: 'var(--accent)' }} />{t('overview.expenses')}</span></div></div>
            <div className="fx-bars" role="group" aria-label={t('overview.last12')}>
              {months.map((x) => (
                <button type="button" key={x.m} className={'fx-bar' + (x.m === month ? ' on' : '')} onClick={() => setMonth(x.m)} aria-label={`${monthNames[x.m - 1]}: ${money(x.expense)}`}>
                  <span className="fx-bar-cols">
                    <i style={{ height: `${(x.income / maxBar) * 100}%`, background: 'var(--teal)' }} />
                    <i style={{ height: `${(x.expense / maxBar) * 100}%`, background: 'var(--accent)' }} />
                  </span>
                  <em>{monthNames[x.m - 1].slice(0, 3)}</em>
                </button>
              ))}
            </div>
          </div>

          {tab === 'overview' ? (
            <div className="fx-card">
              <div className="fx-label">{monthNames[month - 1]} {year}</div>
              <div className={'fx-big' + (cur.income - cur.expense < 0 ? ' fx-neg' : '')} style={{ margin: '6px 0 14px' }}>{money(cur.income - cur.expense)}</div>
              <div className="fx-stat"><span><i className="fx-dot" style={{ background: 'var(--teal)' }} /> {t('overview.incomes')}</span><span className="fx-num">{money(cur.income)}</span></div>
              <div className="fx-stat"><span><i className="fx-dot" style={{ background: 'var(--red)' }} /> {t('overview.expenses')}</span><span className="fx-num">{money(cur.expense)}</span></div>
              <div className="fx-stat"><span>{t('overview.savingsRate')}</span><span className="fx-num">{cur.income > 0 ? `${Math.round(((cur.income - cur.expense) / cur.income) * 100)}%` : '—'}</span></div>
            </div>
          ) : (
            <div className="fx-card">
              <div className="fx-card-head"><Seg value={kind} onChange={setKind} options={[{ id: 'expense', label: t('overview.expenses') }, { id: 'income', label: t('overview.incomes') }]} /></div>
              <div className="fx-donutrow">
                <Donut slices={slices} empty={t('common.noData')} />
                <ul className="fx-catlist">
                  {slices.map((s) => (
                    <li key={s.id}><i className="fx-dot" style={{ background: s.color }} /><span>{s.label}</span><b className="fx-num">{money(s.value)}</b><small>{Math.round((s.value / sliceTotal) * 100)}%</small></li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="fx-card">
          <div className="fx-card-head"><h2>{monthNames[month - 1].slice(0, 3)} {year}</h2><span className="fx-label">{t('overview.txCount', { count: rows.length })}</span></div>
          {rows.length === 0 ? <EmptyState icon={ICON.search} title={t('overview.noTx')} /> : (
            <div className="fx-list">
              {rows.map((x) => {
                const c = cats.find((k) => k.id === x.categoryId);
                return (
                  <div className="fx-item" key={x.id}>
                    <div className="fx-avatar" style={{ background: c?.color || PALETTE[0], color: '#fff' }}>{(c ? catLabel(t, c) : '?').charAt(0).toUpperCase()}</div>
                    <div className="fx-item-main"><b>{x.description || (c ? catLabel(t, c) : '')}</b><span>{dayLabel(x.date)}</span></div>
                    <span className={'fx-num ' + (x.type === 'income' ? 'fx-pos' : '')}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <Sponsored place="Overview" />
    </div>
  );
}
