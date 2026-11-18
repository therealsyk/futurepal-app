import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { salaryGrid, salaryYearSummary, setSalary, addTransaction, softDelete } from '../core/finance';
import { stampNew } from '../db/database';
import type { Category, Transaction } from '../db/database';
import { parseMoneyToCents, formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageHead, Sheet, Field, MonthNav, EmptyState, Ic, ICON } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { todayISO } from '../core/dates';
import { syncSalaryTransactions } from '../core/salaryTx';

// SPEC §6.4: grelha de meses × ano com o salário de cada mês + extras (rendimentos complementares).
export const Salaries = () => {
  const { t } = useTranslation();
  const s = loadSettings();
  const [year, setYear] = useState(new Date().getFullYear());
  const [grid, setGrid] = useState<Array<{ month: number; amountCents: number }>>([]);
  const [summary, setSummary] = useState<{ salaryCents: number; expenseCents: number; savingsCents: number; pctSavings: number } | null>(null);
  const [extras, setExtras] = useState<Transaction[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [open, setOpen] = useState(false);
  const [eName, setEName] = useState('');
  const [eDate, setEDate] = useState(todayISO());
  const [eAmount, setEAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fmt = (c: number) => formatMoney(c, s.currency, s.language);
  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];

  const load = async () => {
    setGrid(await salaryGrid(db, year));
    setSummary(await salaryYearSummary(db, year));
    const cats = await db.categories.filter((c) => c.deletedAt === null && c.name === 'extras').toArray();
    const id = cats[0]?.id;
    setExtras(id ? (await db.transactions.toArray()).filter((tx) => tx.deletedAt === null && tx.categoryId === id && Number(tx.date.slice(0, 4)) === year).sort((a, b) => b.date.localeCompare(a.date)) : []);
    setDrafts({});
  };
  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year]);

  const extrasTotal = extras.reduce((a, x) => a + x.amountCents, 0);
  const salaryTotal = summary?.salaryCents ?? 0;
  const income = salaryTotal + extrasTotal;
  const expense = summary?.expenseCents ?? 0;

  const commit = async (month: number, raw: string) => {
    if (raw.trim() === '') { await setSalary(db, year, month, 0); await syncSalaryTransactions(db).catch(() => {}); await load(); return; }
    const cents = parseMoneyToCents(raw);
    if (cents === null) { setDrafts((d) => { const n = { ...d }; delete n[month]; return n; }); return; }
    await setSalary(db, year, month, cents);
    await syncSalaryTransactions(db).catch(() => {}); // aparece nas Transações como rendimento
    await load();
  };

  const addExtra = async () => {
    const cents = parseMoneyToCents(eAmount);
    if (!eDate || cents === null || cents <= 0) { setError(t('transactions.amountInvalid')); return; }
    let cats = await db.categories.filter((c) => c.deletedAt === null && c.name === 'extras').toArray();
    let id = cats[0]?.id;
    if (!id) {
      const row = stampNew<Category>({ name: 'extras', color: '#34D399', icon: '', order: 99, nameKey: 'salaries.extras' });
      await db.categories.add(row);
      id = row.id;
    }
    await addTransaction(db, { date: eDate, description: eName.trim() || t('salaries.addExtra'), amountCents: cents, type: 'income', categoryId: id, currency: s.currency });
    setOpen(false); setEName(''); setEAmount(''); setError(null);
    await load();
  };

  const today = new Date();
  const isCurrentYear = year === today.getFullYear();

  return (
    <div className="fx-page">
      <PageHead title={t('salaries.title')} sub={t('salaries.subtitle')}>
        <MonthNav label={String(year)} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} />
        <button type="button" className="fx-btn primary" onClick={() => { setError(null); setOpen(true); }}><Ic d={ICON.plus} size={16} />{t('salaries.addExtra')}</button>
      </PageHead>

      <div className="fx-kpis">
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('salaries.annualSalaries')}</div><div className="fx-kpi-value"><span>{fmt(salaryTotal)}</span></div><div className="fx-kpi-sub">{t('salaries.plusExtras', { value: fmt(extrasTotal) })}</div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('salaries.annualExpenses')}</div><div className="fx-kpi-value"><span>{fmt(expense)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('salaries.annualSavings')}</div><div className="fx-kpi-value"><span className={income - expense < 0 ? 'fx-neg' : 'fx-pos'}>{fmt(income - expense)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('salaries.savingsPercent')}</div><div className="fx-kpi-value"><span>{income > 0 ? `${Math.round(((income - expense) / income) * 100)}%` : '—'}</span></div></div>
      </div>

      <div className="fx-card">
        <div className="fx-card-head"><h2>{t('salaries.monthlySalary')}</h2><span className="fx-label">{t('salaries.editHint')}</span></div>
        <div className="fx-salary-grid">
          {grid.map((row) => {
            const missing = isCurrentYear && row.month <= today.getMonth() + 1 && row.amountCents === 0;
            const shown = drafts[row.month] ?? (row.amountCents ? (row.amountCents / 100).toFixed(2).replace('.', ',') : '');
            return (
              <label key={row.month} className={'fx-salary-cell' + (missing ? ' missing' : '')}>
                <span>{monthNames[row.month - 1]}</span>
                <div><input inputMode="decimal" value={shown} placeholder="—" aria-label={`${t('salaries.salaryFor')} ${monthNames[row.month - 1]}`}
                  onChange={(e) => setDrafts({ ...drafts, [row.month]: e.target.value })}
                  onBlur={(e) => { if (drafts[row.month] !== undefined) commit(row.month, e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /><em>{s.currency}</em></div>
              </label>
            );
          })}
        </div>
      </div>

      <div className="fx-card" style={{ marginTop: 16 }}>
        <div className="fx-card-head"><h2>{t('salaries.extras')}</h2><span className="fx-num">{fmt(extrasTotal)}</span></div>
        {extras.length === 0 ? <EmptyState icon={ICON.wallet} title={t('salaries.noExtras')} sub={t('salaries.noExtrasSub')} /> : (
          <div className="fx-list">
            {extras.map((x) => (
              <div className="fx-item" key={x.id}>
                <div className="fx-avatar" style={{ background: 'var(--teal)', color: '#fff' }}><Ic d={ICON.plus} size={16} /></div>
                <div className="fx-item-main"><b>{x.description}</b><span>{x.date}</span></div>
                <span className="fx-num fx-pos">+{fmt(x.amountCents)}</span>
                <button type="button" className="fx-round sm" aria-label={t('common.delete')} onClick={async () => { await softDelete(db, 'transactions', x.id); await load(); }}><Ic d={ICON.trash} size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('salaries.addExtra')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={addExtra}>{t('common.add')}</button></>}>
        {error && <p className="fx-error">{error}</p>}
        <Field label={t('salaries.extraName')}><input className="fx-input" autoFocus value={eName} onChange={(e) => setEName(e.target.value)} /></Field>
        <Field label={t('transactions.amount')}><input className="fx-input big" inputMode="decimal" value={eAmount} placeholder="0,00" onChange={(e) => setEAmount(e.target.value)} /></Field>
        <Field label={t('transactions.date')}><DatePicker value={eDate} onChange={(v) => setEDate(v)} /></Field>
      </Sheet>
    </div>
  );
};
