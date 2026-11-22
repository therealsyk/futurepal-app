import { appConfirm } from '../ui/confirm';
import { openTxForm, useTxSaved } from '../ui/TxForm';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { salaryGrid, salaryYearSummary, setSalary, softDelete } from '../core/finance';
import type { Category, Transaction } from '../db/database';
import { parseMoneyToCents, formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageHead, MonthNav, CatIcon, catLabel, EmptyState, Ic, ICON } from '../ui/fx';
import { isSalaryTx, syncSalaryTransactions } from '../core/salaryTx';
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
  const [cats, setCats] = useState<Category[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const fmt = (c: number) => formatMoney(c, s.currency, s.language);
  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];

  const load = async () => {
    await syncSalaryTransactions(db).catch(() => {}); // salários escritos à mão nas Transações entram na grelha
    setGrid(await salaryGrid(db, year));
    setSummary(await salaryYearSummary(db, year));
    // ano anterior, para as comparações (salário, despesas, poupança e taxa)
    const ps = await salaryYearSummary(db, year - 1);
    const pAll = (await db.transactions.toArray()).filter((tx) => tx.deletedAt === null && tx.type === 'income' && !isSalaryTx(tx) && tx.date.startsWith(String(year - 1)));
    const pExtras = pAll.reduce((a, x) => a + x.amountCents, 0);
    setPrev({ salary: ps.salaryCents, expense: ps.expenseCents, income: ps.salaryCents + pExtras });
    const cats = (await db.categories.toArray()).filter((c) => c.deletedAt === null);
    const sal = new Set(cats.filter((c) => c.nameKey === 'catSalary' || c.nameKey === 'catPension').map((c) => c.id));
    setSalaryCats(sal);
    setCats(cats);
    // extras = todos os rendimentos do ano que não estão na grelha (incluindo um 2.º salário no mesmo mês) (os que vêm das Transações também aparecem aqui)
    setExtras((await db.transactions.toArray())
      .filter((tx) => tx.deletedAt === null && tx.type === 'income' && !isSalaryTx(tx) && tx.date.startsWith(String(year)))
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

  useTxSaved(() => { load().catch(() => {}); });

  const today = new Date();
  const isCurrentYear = year === today.getFullYear();
  const months = isCurrentYear ? today.getMonth() + 1 : 12;
  const avg = (v: number) => t('pco.avgMonth', { v: fmt(Math.round(v / months)) });

  return (
    <div className="fx-page sal-page">
      <PageHead title={t('salaries.title')}>
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
          sub={L('do que recebeste ficou guardado')} bar={income > 0 ? Math.max(0, saved) / income : 0} />
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
          <div className="sal-days">
            {[...new Set(extras.map((x) => x.date))].map((day) => (
              <div key={day} className="sh-day">
                <div className="sh-dayhead"><b>{new Date(day + 'T00:00:00').toLocaleDateString(s.language, { weekday: 'short', day: 'numeric', month: 'short' })}</b></div>
                {extras.filter((x) => x.date === day).map((x) => { const c = cats.find((k) => k.id === x.categoryId); return (
                  <div key={x.id}>
                    <button type="button" className="sh-tx txs-row" onClick={() => setOpenRow(openRow === x.id ? null : x.id)}>
                      <CatIcon cat={c ?? {}} size={36} />
                      <span className="sh-tx-main"><b>{x.description || (c ? catLabel(t, c) : '')}</b><small>{c ? catLabel(t, c) : ''}</small></span>
                      <b className="fx-pos">+{fmt(x.amountCents)}</b>
                    </button>
                    {openRow === x.id && <div className="txs-actions"><button type="button" className="sh-danger" onClick={async () => { if (await appConfirm(L('Apagar este movimento?'))) { await softDelete(db, 'transactions', x.id); setOpenRow(null); await load(); } }}>{L('Apagar')}</button></div>}
                  </div>
                ); })}
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="sal-add floating" onClick={() => openTxForm({ type: 'income' })}><Ic d={ICON.plus} size={16} />{L('Adicionar salário ou extra')}</button>
    </div>
  );
};
