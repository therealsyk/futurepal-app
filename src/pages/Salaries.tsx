import { AddTile } from '../ui/EmptyState';
import { markPeriodChange } from '../ui/rollGate';
import { createPortal } from 'react-dom';
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
import { AmountField } from '../ui/formFields';
import { CountText } from '../ui/CountText';
import { PC_MOBILE } from '../core/uiMode';

const IC = {
  income: 'M12 19V5M5 12l7-7 7 7',
  spent: 'M12 5v14M5 12l7 7 7-7',
  saved: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01',
  pct: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
};

// Grelha de meses × ano com o salário de cada mês + extras (todos os outros rendimentos do ano).
// Sem duplicados: um salário registado à mão nas Transações (categoria Salário) passa para esta grelha,
// e escrever o salário de um mês substitui esse registo manual em vez de o somar.
const fill = (x: string, v: Record<string, string>) => x.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

export const Salaries = () => {
  const { t } = useTranslation();
  const s = loadSettings();
  const [year, setYear] = useState(new Date().getFullYear());
  const [ready, setReady] = useState(false); // só mostra a página quando os dados chegam
  // espera um instante depois dos dados (outros valores ainda se acertam) e só então mostra a página, de uma vez
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!(ready) || shown) return; const id = setTimeout(() => setShown(true), 0); return () => clearTimeout(id); }, [ready, shown]); // eslint-disable-line react-hooks/exhaustive-deps
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
    setReady(true); // tudo carregado: a página aparece
  };
  useEffect(() => { load().catch(() => setReady(true)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year]);

  const [pay, setPay] = useState(''), [later, setLaterS] = useState(() => { try { return sessionStorage.getItem('wallet.salLater') === '1'; } catch { return false; } });
  const setLater = (v: boolean) => { setLaterS(v); try { sessionStorage.setItem('wallet.salLater', '1'); } catch { /* sem storage */ } };
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
  const start = isCurrentYear && summary !== null && income === 0; // ainda sem rendimentos: primeiro pergunta-se quanto recebe
  const avg = (v: number) => t('pco.avgMonth', { v: fmt(Math.round(v / months)) });

  return (
    <div className={'fx-page sal-page' + (shown ? ' pg-ready' : ' pg-wait')}>
      <PageHead title={t('salaries.title')}>
        <MonthNav label={String(year)} onPrev={() => { markPeriodChange(); setYear(year - 1); }} onNext={() => { markPeriodChange(); setYear(year + 1); }} />
      </PageHead>

      {start && !later && createPortal(<div className="spi-back sal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setLater(true); }}><section className="mv-card sal-start" role="dialog" aria-modal="true" aria-label={L('Quanto recebes por mês?')}>
        <button type="button" className="tipb-x lg-x" onClick={() => setLater(true)} aria-label={L('Fechar')}><Ic d={ICON.close} size={18} /></button>
        <span className="on-logo sm"><Ic d="M3 7h18v12H3zM3 11h18M7 15h3" size={30} /></span>
        <h2>{L('Quanto recebes por mês?')}</h2>
        <p>{L('Escreve o que recebeste este mês. Com isso, a app mostra quanto te sobra e quanto podes poupar.')}</p>
        <AmountField value={pay} onChange={setPay} currency={s.currency} kind="income" />
        <button type="button" className="ob-cta lg-go" disabled={(parseMoneyToCents(pay) ?? 0) <= 0} onClick={() => { commit(today.getMonth() + 1, pay).then(() => setPay('')).catch(() => {}); }}>{L('Guardar')}<Ic d="M5 12h14M13 6l6 6-6 6" size={18} /></button>
        <button type="button" className="on-skip" onClick={() => setLater(true)}>{L('Agora não')}</button>
      </section></div>, document.body)}
      {!PC_MOBILE ? (() => {
        const pct = (v: number | null) => (v === null ? null : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
        const ds = dl(salaryTotal, prev.salary);
        return <section className="mv-card sal-hero">
          <div className="sal-hhead"><span className="sal-hic"><Ic d={IC.income} size={17} /></span><small>{t('salaries.annualSalaries')}</small>
            {ds !== null && <em className={'fx-chip ' + (ds >= 0 ? 'good' : 'warn')}>{pct(ds)} <small>{t('pco.vs')} {year - 1}</small></em>}</div>
          <strong className="sal-hval"><CountText text={fmt(salaryTotal)} /></strong>
          <small className="sal-hsub">{t('salaries.plusExtras', { value: fmt(extrasTotal) })}</small>
          <span className="sal-hbar" aria-hidden="true"><i className="exp" style={{ width: `${income > 0 ? Math.min(100, (expense / income) * 100) : 0}%` }} /><i className="sav" style={{ width: `${income > 0 ? Math.max(0, Math.min(100, (saved / income) * 100)) : 0}%` }} /></span>
          <div className="sal-hstats">
            <span className="exp"><small>{L('Despesas')}</small><b><CountText text={fmt(expense)} /></b><em>{fmt(Math.round(expense / months))}/{L('mês')}</em></span>
            <span className={saved < 0 ? 'exp' : 'sav'}><small>{L('Poupança')}</small><b><CountText text={fmt(saved)} /></b><em>{fmt(Math.round(saved / months))}/{L('mês')}</em></span>
            <span className="rate"><small>{L('Taxa de poupança')}</small><b><CountText text={income > 0 ? `${Math.round(rate * 100)}%` : '—'} /></b></span>
          </div>
        </section>;
      })() : <div className="pco-metrics-row">
        <Metric icon={IC.income} tone="inc" title={t('salaries.annualSalaries')} value={fmt(salaryTotal)} valueClass="fx-pos" delta={dl(salaryTotal, prev.salary)} deltaGoodUp {...cmp}
          sub={t('salaries.plusExtras', { value: fmt(extrasTotal) })} bar={income > 0 ? salaryTotal / income : 0} />
        <Metric icon={IC.spent} tone="exp" title={t('salaries.annualExpenses')} value={fmt(expense)} valueClass={expense > 0 ? 'fx-neg' : ''} delta={dl(expense, prev.expense)} deltaGoodUp={false} {...cmp}
          sub={avg(expense)} bar={income > 0 ? expense / income : 0} />
        <Metric icon={IC.saved} tone="sav" title={t('salaries.annualSavings')} value={fmt(saved)} valueClass={saved < 0 ? 'fx-neg' : 'fx-pos'} delta={dl(saved, prevSaved)} deltaGoodUp {...cmp}
          sub={avg(saved)} bar={income > 0 ? Math.max(0, saved) / income : 0} />
        <Metric icon={IC.pct} tone="sav" title={L('Taxa de poupança')} value={income > 0 ? `${Math.round((saved / income) * 100)}%` : '—'} delta={prev.income > 0 && income > 0 ? dl(rate, prevRate) : null} deltaGoodUp {...cmp}
          sub='' bar={income > 0 ? Math.max(0, saved) / income : 0} />
      </div>}

      <div className="fx-card">
        <div className="sal-xhead sal-mhead">
          <span className="sal-xic sal-mic"><Ic d="M3 7h18v12H3zM3 11h18M7 15h3" size={18} /></span>
          <div className="sal-xtt"><h2>{t('salaries.monthlySalary')}</h2><small>{t('salaries.editHint')}</small></div>
        </div>
        <div className="fx-salary-grid">
          {grid.map((row) => {
            const missing = isCurrentYear && row.month <= today.getMonth() + 1 && row.amountCents === 0;
            const shown = drafts[row.month] ?? (row.amountCents ? (row.amountCents / 100).toFixed(2).replace('.', ',') : '');
            return (
              <label key={row.month} className={'fx-salary-cell' + (missing ? ' missing' : '') + (isCurrentYear && row.month === today.getMonth() + 1 ? ' now' : '')} style={{ '--i': row.month - 1 } as React.CSSProperties}>
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
        <div className="sal-xhead">
          <span className="sal-xic"><Ic d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" size={18} /></span>
          <div className="sal-xtt"><h2>{t('salaries.extras')}</h2><small>{L('Tudo o que recebeste além do salário')}</small></div>
          {extras.length > 0 && <span className="sal-xtot"><b className="fx-pos">+<CountText text={fmt(extrasTotal)} /></b><small>{extras.length === 1 ? fill(L('1 rendimento em {y}'), { y: String(year) }) : fill(L('{n} rendimentos em {y}'), { n: String(extras.length), y: String(year) })}</small></span>}
        </div>
        {extras.length === 0 ? <EmptyState icon={ICON.wallet} title={t('salaries.noExtras')} sub={t('salaries.noExtrasSub')} /> : (
          <div className="sal-days">
            {[...new Set(extras.map((x) => x.date))].map((day, di, arr) => (
              <div key={day} className="sh-day">
                {(di === 0 || arr[di - 1].slice(0, 7) !== day.slice(0, 7)) && <div className="txs-month sal-xmonth"><span>{new Date(day.slice(0, 7) + '-01T12:00:00').toLocaleDateString(s.language, { month: 'long' })}<em>+{fmt(extras.filter((x) => x.date.startsWith(day.slice(0, 7))).reduce((a, x) => a + x.amountCents, 0))}</em></span></div>}
                <div className="sh-dayhead"><b>{new Date(day + 'T00:00:00').toLocaleDateString(s.language, { weekday: 'short', day: 'numeric', month: 'short' })}</b></div>
                {extras.filter((x) => x.date === day).map((x) => { const c = cats.find((k) => k.id === x.categoryId); return (
                  <div key={x.id}>
                    <button type="button" className="sh-tx txs-row" onClick={() => setOpenRow(openRow === x.id ? null : x.id)}>
                      <CatIcon cat={c ?? {}} size={36} />
                      <span className="sh-tx-main"><b>{x.description || (c ? catLabel(t, c) : '')}</b><small>{c ? catLabel(t, c) : ''}</small></span>
                      <b className="fx-pos">{fmt(x.amountCents)}</b>
                    </button>
                    {openRow === x.id && <div className="txs-actions"><button type="button" className="sh-danger" onClick={async () => { if (await appConfirm(L('Apagar este movimento?'))) { await softDelete(db, 'transactions', x.id); setOpenRow(null); await load(); } }}>{L('Apagar')}</button></div>}
                  </div>
                ); })}
              </div>
            ))}
          </div>
        )}
      </div>
      <AddTile cls="sal-addtile" label={L('Adicionar salário ou extra')} onClick={() => openTxForm({ type: 'income' })} />
    </div>
  );
};
