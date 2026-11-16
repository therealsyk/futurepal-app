import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { salaryGrid, salaryYearSummary, setSalary, addTransaction } from '../core/finance';
import { stampNew } from '../db/database';
import type { Category, Transaction } from '../db/database';
import { parseMoneyToCents, formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';

// SPEC §6.4: grid of months x year with the salary for each month + "extras"
// (complementary income). Each cell holds a value; totals shown per month/year.
export const Salaries = () => {
  const { t } = useTranslation();
  const s = loadSettings();
  const [year, setYear] = useState(new Date().getFullYear());
  const [grid, setGrid] = useState<Array<{ month: number; amountCents: number }>>([]);
  const [summary, setSummary] = useState<any>(null);
  const [extras, setExtras] = useState<Transaction[]>([]);
  const [extraCatId, setExtraCatId] = useState<string | null>(null);

  useEffect(() => {
    salaryGrid(db, year).then(setGrid).catch(() => setGrid([]));
    salaryYearSummary(db, year).then(setSummary).catch(() => setSummary(null));
    Promise.all([db.categories.filter((c) => c.deletedAt === null && c.name === 'extras').toArray(), db.transactions.toArray()])
      .then(([cats, all]) => {
        const id = cats[0]?.id ?? null;
        setExtraCatId(id);
        setExtras(id ? all.filter((tx) => tx.deletedAt === null && tx.categoryId === id && Number(tx.date.slice(0, 4)) === year) : []);
      })
      .catch(() => setExtras([]));
  }, [year]);

  const fmt = (cents: number) => formatMoney(cents, s.currency, s.language);
  const sumCents = (txs: Transaction[]) => txs.reduce((a, tx) => a + tx.amountCents, 0);

  // Controlled input: raw user text while typing; re-syncs from DB after save.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const refresh = async () => {
    setGrid(await salaryGrid(db, year));
    setSummary(await salaryYearSummary(db, year));
    setDrafts({});
  };

  return (
    <div>
      <h1 className="page-title">{t('salaries.title')}</h1>
      <div className="stat-row">
        <label htmlFor="salary-year">{t('salaries.yearLabel')}</label>
        <input id="salary-year" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input id="extra-name" type="text" placeholder={t('salaries.extraName') || t('salaries.addExtra')} />
        <input id="extra-date" type="date" />
        <input id="extra-amount" type="number" min="0" step="0.01" />
        <button type="button" onClick={async () => {
          const name = (document.getElementById('extra-name') as HTMLInputElement)?.value || t('salaries.addExtra');
          const date = (document.getElementById('extra-date') as HTMLInputElement)?.value;
          const amount = parseMoneyToCents((document.getElementById('extra-amount') as HTMLInputElement)?.value || '0') ?? 0;
          if (!date || amount <= 0) return;
          let catId = extraCatId;
          if (!catId) {
            const created = await db.categories.add(stampNew<Category>({ name: 'extras', color: '#34D399', icon: '', order: 99, nameKey: 'salaries.extras' }));
            catId = String(created);
            setExtraCatId(catId);
          }
          await addTransaction(db, { date, description: name, amountCents: amount, type: 'income', categoryId: catId, currency: s.currency });
          salaryGrid(db, year).then(setGrid);
          salaryYearSummary(db, year).then(setSummary);
          setExtras(await db.transactions.filter((tx) => tx.deletedAt === null && tx.categoryId === catId && Number(tx.date.slice(0, 4)) === year).toArray());
        }}>{t('salaries.addExtra')}</button>
      </div>
      <h3>{t('salaries.extras')}</h3>
      {extras.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {extras.map((tx) => (
            <li key={tx.id}>{tx.date} — {tx.description}: {fmt(tx.amountCents)}</li>
          ))}
        </ul>
      )}
      <div className="salary-grid">
        {grid.map((row) => (
          <div key={row.month} className="salary-cell">
            <span>{t('salaries.salaryFor')} {(t('calendar.monthNames', { returnObjects: true }) as string[])[row.month - 1]}</span>
            <input
              type="text"
              value={drafts[row.month] ?? fmt(row.amountCents)}
              onChange={(e) => {
                const raw = e.target.value;
                const cents = parseMoneyToCents(raw);
                if (cents === null) {
                  setDrafts((d) => ({ ...d, [row.month]: raw }));
                  return;
                }
                setSalary(db, year, row.month, cents)
                  .then(refresh)
                  .catch(() => setDrafts((d) => ({ ...d, [row.month]: raw })));
              }}
            />
          </div>
        ))}
      </div>

      {summary && (
        <div className="overview-grid">
          <div className="stat-tile">
            <span className="stat-label">{t('salaries.annualSalaries')}</span>
            <span className="stat-value">{fmt(summary.salaryCents + sumCents(extras))}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">{t('salaries.extras')}</span>
            <span className="stat-value">{fmt(sumCents(extras))}</span>
          </div>
        </div>
      )}
    </div>
  );
};
