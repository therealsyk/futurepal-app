import { FormError, useMissing } from '../ui/missing';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { salaryGrid, salaryYearSummary, setSalary, addTransaction, softDelete, addRecurring, materializeDueRecurrings, RECURRING_FREQUENCIES, activeCategories } from '../core/finance';
import { stampNew } from '../db/database';
import type { Account, Category, Transaction, RecurringFrequency } from '../db/database';
import { parseMoneyToCents, formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageHead, Sheet, MonthNav, EmptyState, Ic, ICON, CategorySelect, PickMenu } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { todayISO } from '../core/dates';
import { isSalaryTx, syncSalaryTransactions } from '../core/salaryTx';
import { defaultAccountId } from '../core/accounts';
import { Metric } from './PcOverview';
import { L } from '../i18n/phrases';

const IC = {
  income: 'M12 19V5M5 12l7-7 7 7',
  spent: 'M12 5v14M5 12l7 7 7-7',
  saved: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01',
  pct: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
};

// Grelha de meses × ano com o salário de cada mês + extras (todos os outros rendimentos do ano).
// Sem duplicados: um salário registado à mão nas Transações (categoria Salário) passa para esta grelha,
// e escrever o salário de um mês substitui esse registo manual em vez de o somar.
export const Salaries = () => {
  const { t } = useTranslation();
  const s = loadSettings();
  const [year, setYear] = useState(new Date().getFullYear());
  const [grid, setGrid] = useState<Array<{ month: number; amountCents: number }>>([]);
  const [summary, setSummary] = useState<{ salaryCents: number; expenseCents: number; savingsCents: number; pctSavings: number } | null>(null);
  const [extras, setExtras] = useState<Transaction[]>([]);
  const [prev, setPrev] = useState({ salary: 0, expense: 0, income: 0 });
  const [salaryCats, setSalaryCats] = useState<Set<string>>(new Set());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [open, setOpen] = useState(false);
  const [eName, setEName] = useState('');
  const missing = useMissing();
  const [eDate, setEDate] = useState(todayISO());
  const [eAmount, setEAmount] = useState('');
  const [eAcc, setEAcc] = useState('');
  const [eCat, setECat] = useState('');
  const [cats, setCats] = useState<Category[]>([]);
  const [eRec, setERec] = useState(false);
  const [eFreq, setEFreq] = useState<RecurringFrequency>('monthly');
  const [eEnd, setEEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fmt = (c: number) => formatMoney(c, s.currency, s.language);
  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];

  const load = async () => {
    await syncSalaryTransactions(db).catch(() => {}); // salários escritos à mão nas Transações entram na grelha
    setGrid(await salaryGrid(db, year));
    setSummary(await salaryYearSummary(db, year));
    // ano anterior, para as comparações (salário, despesas, poupança e taxa)
    const ps = await salaryYearSummary(db, year - 1);
    const pAll = (await db.transactions.toArray()).filter((tx) => tx.deletedAt === null && tx.type === 'income' && !isSalaryTx(tx) && tx.date.startsWith(String(year - 1)));
    const salCats = new Set((await db.categories.toArray()).filter((c) => c.nameKey === 'catSalary' || c.nameKey === 'catPension').map((c) => c.id));
    const pExtras = pAll.filter((tx) => !salCats.has(tx.categoryId)).reduce((a, x) => a + x.amountCents, 0);
    setPrev({ salary: ps.salaryCents, expense: ps.expenseCents, income: ps.salaryCents + pExtras });
    const cats = (await db.categories.toArray()).filter((c) => c.deletedAt === null);
    const sal = new Set(cats.filter((c) => c.nameKey === 'catSalary' || c.nameKey === 'catPension').map((c) => c.id));
    setSalaryCats(sal);
    const accs = (await db.accounts.toArray()).filter((a) => a.deletedAt === null);
    setAccounts(accs);
    // extras = todos os rendimentos do ano que não são o salário (os que vêm das Transações também aparecem aqui)
    setExtras((await db.transactions.toArray())
      .filter((tx) => tx.deletedAt === null && tx.type === 'income' && !isSalaryTx(tx) && !sal.has(tx.categoryId) && tx.date.startsWith(String(year)))
      .sort((a, b) => b.date.localeCompare(a.date)));
    setDrafts({});
  };
  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year]);

  const extrasTotal = extras.reduce((a, x) => a + x.amountCents, 0);
  const salaryTotal = summary?.salaryCents ?? 0;
  const income = salaryTotal + extrasTotal;
  const expense = summary?.expenseCents ?? 0;
  const saved = income - expense;
  const prevSaved = prev.income - prev.expense;
  const rate = income > 0 ? saved / income : 0, prevRate = prev.income > 0 ? prevSaved / prev.income : 0;
  const dl = (n: number, b: number) => (b === 0 ? null : (n - b) / Math.abs(b));
  const cmp = { prevName: String(year - 1), vsLabel: t('pco.vs') };

  const commit = async (month: number, raw: string) => {
    const cents = raw.trim() === '' ? 0 : parseMoneyToCents(raw);
    if (cents === null) { setDrafts((d) => { const n = { ...d }; delete n[month]; return n; }); return; }
    // o salário escrito aqui substitui um salário registado à mão nas Transações nesse mês (não soma os dois)
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const now = new Date().toISOString();
    for (const tx of await db.transactions.toArray()) {
      if (tx.deletedAt === null && tx.type === 'income' && !isSalaryTx(tx) && salaryCats.has(tx.categoryId) && tx.date.startsWith(ym)) {
        await db.transactions.update(tx.id, { deletedAt: now, updatedAt: now });
      }
    }
    await setSalary(db, year, month, cents);
    await syncSalaryTransactions(db).catch(() => {}); // aparece nas Transações como rendimento
    await load();
  };

  const extrasCat = async (): Promise<string> => {
    const found = await db.categories.filter((c) => c.deletedAt === null && c.name === 'extras').toArray();
    if (found[0]) return found[0].id;
    const row = stampNew<Category>({ name: 'extras', color: '#34D399', icon: '', order: 99, nameKey: 'salaries.extras' });
    await db.categories.add(row);
    return row.id;
  };
  const openExtra = async () => {
    setError(null); setEName(''); setEAmount(''); setEDate(todayISO()); setERec(false); setEEnd(''); setEFreq('monthly');
    const id = await extrasCat();
    setCats(await activeCategories(db)); setECat(id);
    setEAcc(defaultAccountId(accounts) ?? accounts[0]?.id ?? '');
    setOpen(true);
  };

  const miss = missing([['amount', L('o valor'), (parseMoneyToCents(eAmount) ?? 0) > 0], ['date', L('a data'), !!eDate]]);
  const addExtra = async () => {
    const cents = parseMoneyToCents(eAmount);
    setError(null);
    if (!miss.check() || cents === null) return;
    // já existe? (mesmo valor a 3 dias ou menos, registado aqui ou nas Transações)
    const day = (d: string) => new Date(d + 'T00:00:00').getTime() / 864e5;
    const all = (await db.transactions.toArray()).filter((x) => x.deletedAt === null && x.type === 'income');
    if (all.some((x) => x.amountCents === cents && Math.abs(day(x.date) - day(eDate)) <= 3)) { setError(L('Já existe um rendimento com este valor nesta data.')); return; }
    const id = eCat || await extrasCat();
    const description = eName.trim() || t('salaries.addExtra');
    if (eRec) {
      if (eEnd && eEnd < eDate) { setError(t('transactions.endBeforeStart')); return; }
      await addRecurring(db, { type: 'income', categoryId: id, description, amountCents: cents, currency: s.currency, frequency: eFreq, nextDate: eDate, endDate: eEnd || null, accountId: eAcc || undefined });
      await materializeDueRecurrings(db, todayISO());
    } else {
      await addTransaction(db, { date: eDate, description, amountCents: cents, type: 'income', categoryId: id, currency: s.currency, accountId: eAcc || undefined });
    }
    setOpen(false);
    await load();
  };

  const today = new Date();
  const isCurrentYear = year === today.getFullYear();
  const months = isCurrentYear ? today.getMonth() + 1 : 12;
  const avg = (v: number) => t('pco.avgMonth', { v: fmt(Math.round(v / months)) });

  return (
    <div className="fx-page sal-page">
      <PageHead title={t('salaries.title')} sub={t('salaries.subtitle')}>
        <MonthNav label={String(year)} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} />
      </PageHead>

      <div className="pco-metrics-row">
        <Metric icon={IC.income} tone="inc" title={t('salaries.annualSalaries')} value={fmt(salaryTotal)} valueClass="fx-pos" delta={dl(salaryTotal, prev.salary)} deltaGoodUp {...cmp}
          sub={t('salaries.plusExtras', { value: fmt(extrasTotal) })} bar={income > 0 ? salaryTotal / income : 0} />
        <Metric icon={IC.spent} tone="exp" title={t('salaries.annualExpenses')} value={fmt(expense)} valueClass={expense > 0 ? 'fx-neg' : ''} delta={dl(expense, prev.expense)} deltaGoodUp={false} {...cmp}
          sub={avg(expense)} bar={income > 0 ? expense / income : 0} />
        <Metric icon={IC.saved} tone="sav" title={t('salaries.annualSavings')} value={fmt(saved)} valueClass={saved < 0 ? 'fx-neg' : 'fx-pos'} delta={dl(saved, prevSaved)} deltaGoodUp {...cmp}
          sub={avg(saved)} bar={income > 0 ? Math.max(0, saved) / income : 0} />
        <Metric icon={IC.pct} tone="sav" title={L('Taxa de poupança')} value={income > 0 ? `${Math.round((saved / income) * 100)}%` : '—'} delta={prev.income > 0 && income > 0 ? dl(rate, prevRate) : null} deltaGoodUp {...cmp}
          bar={income > 0 ? Math.max(0, saved) / income : 0} />
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

      <div className="fx-card sal-extras" style={{ marginTop: 16 }}>
        <div className="fx-card-head"><h2>{t('salaries.extras')}</h2><span className="fx-num">{fmt(extrasTotal)}</span></div>
        {extras.length === 0 ? <EmptyState icon={ICON.wallet} title={t('salaries.noExtras')} sub={t('salaries.noExtrasSub')} /> : (
          <div className="fx-list">
            {extras.map((x) => (
              <div className="fx-item" key={x.id}>
                <div className="fx-avatar" style={{ background: 'var(--teal)', color: '#fff' }}><Ic d={ICON.plus} size={16} /></div>
                <div className="fx-item-main"><b>{x.description}</b><span>{new Date(x.date + 'T00:00:00').toLocaleDateString(s.language, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <span className="fx-num fx-pos">+{fmt(x.amountCents)}</span>
                <button type="button" className="fx-round sm" aria-label={t('common.delete')} onClick={async () => { await softDelete(db, 'transactions', x.id); await load(); }}><Ic d={ICON.trash} size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="sal-add floating" onClick={() => { openExtra().catch(() => {}); }}><Ic d={ICON.plus} size={16} />{t('salaries.addExtra')}</button>

      {/* Adicionar extra: mesmo formulário das transações (valor grande e linhas com ícone) */}
      <Sheet open={open} onClose={() => { setOpen(false); miss.reset(); }} title={t('salaries.addExtra')}
        footer={<button type="button" className="tx-addbtn" onClick={addExtra}>{t('salaries.addExtra')}</button>}>
        {miss.note ?? (error && <FormError text={error} />)}
        <input className={'tx-amt inc' + miss.cls('amount')} autoFocus inputMode="decimal" value={eAmount} placeholder="0" onChange={(e) => setEAmount(e.target.value)} aria-label={t('transactions.amount')} />
        <span className="tx-cur">{s.currency}</span>
        <div className="tx-rows">
          <div className="tx-row"><span><Ic d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" size={18} />{t('transactions.category')}</span>
            <CategorySelect cats={cats} kind="income" value={eCat} onChange={setECat} ariaLabel={t('transactions.category')} className="fx-input tx-val" /></div>
          <label className="tx-row"><span><Ic d="M4 20h4L19 9l-4-4L4 16z" size={18} />{t('salaries.extraName')}</span>
            <input className="tx-val" value={eName} placeholder={L('Ex.: Prémio, horas extra, venda')} onChange={(e) => setEName(e.target.value)} /></label>
          {accounts.length > 0 && <label className="tx-row"><span><Ic d={ICON.wallet} size={18} />{t('accounts.account')}</span>
            <PickMenu compact label={t('accounts.account')} value={eAcc} options={accounts.filter((a) => a.type !== 'debt').map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => setEAcc(String(v))} /></label>}
          <div className="tx-row"><span><Ic d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4" size={18} />{t('transactions.date')}</span>
            <DatePicker value={eDate} onChange={(v) => setEDate(v)} className="fx-input tx-val" /></div>
          <div className="tx-row"><span><Ic d="M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a5 5 0 1 0 1 6" size={18} />{L('Recorrente')}</span>
            <button type="button" role="switch" aria-checked={eRec} className={'ob-toggle' + (eRec ? ' on' : '')} onClick={() => setERec(!eRec)} aria-label={L('Recorrente')}><i /></button></div>
          {eRec && (<>
            <label className="tx-row tx-sub"><span>{t('goals.frequency')}</span>
              <PickMenu compact label={t('goals.frequency')} value={eFreq} options={RECURRING_FREQUENCIES.map((f) => ({ value: f, label: t('goals.' + f) }))} onChange={(v) => setEFreq(v as RecurringFrequency)} /></label>
            <div className="tx-row tx-sub"><span>{L('Termina em')}</span>
              <DatePicker value={eEnd} onChange={setEEnd} allowEmpty className="fx-input tx-val" /></div>
          </>)}
        </div>
      </Sheet>
    </div>
  );
};
