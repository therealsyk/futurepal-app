import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SIMPLE_UI } from '../core/uiMode';
import { EmptyState as EmptyHero } from '../ui/EmptyState';
import { accountBalanceCents as balOfAcc, addTransfer, salariesUntil } from '../core/accounts';
import { useIsMobile } from '../ui/useIsMobile';
import { useSearchParams } from 'react-router-dom';
import { db } from '../db/app-db';
import type { Transaction, Transfer, Category, Group, RecurringFrequency } from '../db/database';
import { addTransaction, addRecurring, materializeDueRecurrings, RECURRING_FREQUENCIES, softDelete, activeCategories, filterTransactions, listGroups } from '../core/finance';
import { txsOfAccount, defaultAccountId, ALL_ACCOUNTS, loadTransfers, removeTransfer } from '../core/accounts';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { catLabel, PageHead, Seg, Sheet, Toggle, Field, MonthNav, EmptyState, AccountSwitch, Ic, ICON, useAccounts, CategorySelect, CatIcon } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { todayISO } from '../core/dates';
import { syncSalaryTransactions } from '../core/salaryTx';
import { Sponsored } from '../ui/Sponsored';

const COLORS = ['#8b7cf6', '#5fd4c4', '#e58fd3', '#f5b85a', '#60a5fa', '#4ade9b', '#f87171'];

export function Transactions() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const now = new Date();
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? ''); // vindo do Resumo: ?mes=2026-11 ou ?ano=2026
  const qm = /^(\d{4})-(\d{2})$/.exec(q.get('mes') ?? ''), qy = Number(q.get('ano')) || 0;
  const [year, setYear] = useState(qm ? +qm[1] : qy || now.getFullYear());
  const [month, setMonth] = useState(qm ? +qm[2] : now.getMonth() + 1);
  const [period, setPeriod] = useState<'month' | 'year'>(qy && !qm ? 'year' : 'month'); // ver um mês ou o ano inteiro
  const { accounts, active, setActive } = useAccounts();

  const [txs, setTxs] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [kind, setKind] = useState<'all' | 'expense' | 'income'>('all');
  const [filterCat, setFilterCat] = useState('');
  const [filterText, setFilterText] = useState('');

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [freq, setFreq] = useState<RecurringFrequency>('monthly');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const rows = await filterTransactions(db, { year, month: period === 'month' ? month : undefined, categoryId: filterCat || undefined, text: filterText });
    setTxs(rows);
    const cs = await activeCategories(db);
    setCats(cs);
    setGroups(await listGroups(db));
    setTransfers(await loadTransfers(db));
    setCategoryId((cur) => cur || cs[0]?.id || '');
  };
  useEffect(() => { refresh().catch((e) => setError(String(e))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year, month, period, filterCat, filterText]);

  const visible = useMemo(
    () => txsOfAccount(txs, active, accounts).filter((x) => kind === 'all' || x.type === kind).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [txs, active, accounts, kind],
  );
  const money = (c: number, cur = settings.currency) => formatMoney(c, cur, settings.language);
  const income = visible.filter((x) => x.type === 'income').reduce((s, x) => s + x.amountCents, 0);
  const expense = visible.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amountCents, 0);

  // Transferências entre contas também aparecem na lista (não contam como rendimento nem despesa).
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
  const visibleTransfers = useMemo(() => {
    if (kind !== 'all' || filterCat) return [];
    const prefix = period === 'month' ? `${year}-${String(month).padStart(2, '0')}` : `${year}-`;
    const q = filterText.trim().toLowerCase();
    return transfers.filter((tr) => tr.date.startsWith(prefix)
      && (active === ALL_ACCOUNTS || tr.fromAccountId === active || tr.toAccountId === active)
      && (!q || `${tr.note} ${nameOf(tr.fromAccountId)} ${nameOf(tr.toAccountId)}`.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfers, year, month, period, active, kind, filterCat, filterText, accounts]);

  const byDay = useMemo(() => {
    const m = new Map<string, { txs: Transaction[]; trs: Transfer[] }>();
    const get = (d: string) => m.get(d) ?? m.set(d, { txs: [], trs: [] }).get(d)!;
    for (const x of visible) get(x.date).txs.push(x);
    for (const tr of visibleTransfers) get(tr.date).trs.push(tr);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible, visibleTransfers]);

  const removeTr = async (id: string) => { await removeTransfer(db, id); await refresh(); };

  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];
  const shift = (d: number) => {
    if (period === 'year') { setYear((y) => y + d); return; }
    let m = month + d, y = year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };

  const isMobile = useIsMobile();
  const [moreOpts, setMoreOpts] = useState(false);
  const openNew = () => {
    setMoreOpts(false);
    setError(null); setAmount(''); setDescription('');
    setAccountId(active !== ALL_ACCOUNTS ? active : defaultAccountId(accounts) ?? '');
    setOpen(true);
  };

  // O botão "+" do telemóvel abre esta página com ?nova=1 -> abre logo o formulário.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('nova') && accounts.length > 0) {
      openNew();
      setType(params.get('tipo') === 'income' ? 'income' : 'expense'); // "Recebi" abre já como rendimento
      if (params.get('grupo')) setGroupId(params.get('grupo')!); // vindo de um grupo
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, accounts.length]);

  const [toAccount, setToAccount] = useState(''); // modo simples: '' = transação normal; id = transferência para essa conta
  const [bals, setBals] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!SIMPLE_UI || !open) return;
    (async () => {
      const [all, trs, sals] = await Promise.all([db.transactions.toArray(), db.transfers.toArray(), db.salaries.toArray()]);
      const n = new Date(); const sal = salariesUntil(sals, n.getFullYear(), n.getMonth() + 1);
      const live = all.filter((x) => x.deletedAt === null), lt = trs.filter((x) => x.deletedAt === null);
      setBals(Object.fromEntries(accounts.map((a) => [a.id, balOfAcc(a, live, accounts, sal, lt)])));
    })().catch(() => {});
  }, [open, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) { setError(t('transactions.amountInvalid')); return; }
    if (SIMPLE_UI && toAccount) { // transferência entre contas (pode repetir-se)
      try {
        if (recurring) {
          if (endDate && endDate < date) { setError(t('transactions.endBeforeStart')); return; }
          await addRecurring(db, { type: 'expense', categoryId: categoryId || (cats[0]?.id ?? ''), description: description.trim() || 'Transferência', amountCents: cents, currency: settings.currency, frequency: freq, nextDate: date, endDate: endDate || null, accountId, toAccountId: toAccount });
          await materializeDueRecurrings(db, todayISO());
          setRecurring(false); setEndDate('');
        } else {
          await addTransfer(db, { fromAccountId: accountId, toAccountId: toAccount, amountCents: cents, date, note: description.trim(), categoryId: null });
        }
        setToAccount(''); setAmount(''); setDescription(''); setOpen(false); await refresh();
      } catch (e) { setError(String(e)); }
      return;
    }
    if (!categoryId) { setError(t('transactions.pickCategory')); return; }
    try {
      if (recurring) {
        if (endDate && endDate < date) { setError(t('transactions.endBeforeStart')); return; }
        // A recorrente gera a 1.ª ocorrência (se a data já chegou) e as seguintes quando vencerem.
        await addRecurring(db, { type, categoryId, description: description.trim(), amountCents: cents, currency: settings.currency, frequency: freq, nextDate: date, endDate: endDate || null, accountId: accountId || undefined });
        await materializeDueRecurrings(db, todayISO());
      } else {
        await addTransaction(db, { date, type, categoryId, description: description.trim(), amountCents: cents, currency: settings.currency, groupId: groupId || undefined, accountId: accountId || undefined });
        if (type === 'income') await syncSalaryTransactions(db).catch(() => {}); // categoria Salário -> aba Salários
      }
      setRecurring(false); setEndDate(''); setAmount(''); setDescription('');
      setOpen(false);
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const remove = async (id: string) => { await softDelete(db, 'transactions', id); await refresh(); };
  const dayLabel = (d: string) => new Intl.DateTimeFormat(settings.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00'));

  const [openRow, setOpenRow] = useState<string | null>(null);
  // Nº de transações do período anterior (mês ou ano), para a comparação em %
  const [prevCount, setPrevCount] = useState<number | null>(null);
  useEffect(() => {
    const py = period === 'year' ? year - 1 : month === 1 ? year - 1 : year;
    const pm = period === 'year' ? undefined : month === 1 ? 12 : month - 1;
    filterTransactions(db, { year: py, month: pm }).then((r) => setPrevCount(txsOfAccount(r, active, accounts).filter((x) => kind === 'all' || x.type === kind).length)).catch(() => setPrevCount(null));
  }, [year, month, period, kind, active, accounts]);
  const [dayOnly, setDayOnly] = useState<string | null>(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('dia'));
  const shiftP = (k: number) => {
    if (period === 'year') { setYear(year + k); return; }
    let mm = month + k, yy = year;
    if (mm < 1) { mm = 12; yy--; } if (mm > 12) { mm = 1; yy++; }
    setMonth(mm); setYear(yy);
  };
  const periodLabel = period === 'year' ? String(year) : new Date(year, month - 1, 1).toLocaleDateString(settings.language, { month: 'long', year: 'numeric' });
  const simple = SIMPLE_UI && isMobile;

  return (
    <div className={'fx-page' + (simple ? ' tx-simple' : '')}>
      {simple && (
        <div className="txs-new mv sh">
          {/* Transações (telemóvel): só a lista completa, com filtros simples */}
          <header className="mv-head"><h1 className="sh-title">Transações</h1></header>
          <button type="button" className="sh-btn in txs-add" onClick={openNew}><Ic d={ICON.plus} size={18} />Nova transação</button>
          <div className="sh-seg" role="tablist">
            <button type="button" className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Mês</button>
            <button type="button" className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>Ano</button>
          </div>
          <div className="sh-monthnav">
            <button type="button" className="mv-chev" onClick={() => shiftP(-1)} aria-label="Anterior"><Ic d={ICON.left} size={18} /></button>
            <span className="mv-month">{periodLabel}</span>
            <button type="button" className="mv-chev" onClick={() => shiftP(1)} aria-label="Seguinte"><Ic d={ICON.right} size={18} /></button>
          </div>
          <div className="sh-seg small three" role="tablist">
            <button type="button" className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>Todas</button>
            <button type="button" className={kind === 'expense' ? 'on' : ''} onClick={() => setKind('expense')}>Despesas</button>
            <button type="button" className={kind === 'income' ? 'on' : ''} onClick={() => setKind('income')}>Rendimentos</button>
          </div>
          {(() => {
            const n = visible.length;
            const nowD = new Date();
            const isCur = year === nowD.getFullYear() && (period === 'year' || month === nowD.getMonth() + 1);
            const span = period === 'month' ? (isCur ? nowD.getDate() : new Date(year, month, 0).getDate()) : (isCur ? nowD.getMonth() + 1 : 12);
            const avg = span > 0 ? n / span : 0;
            const top = visible.filter((x) => x.type === 'expense').sort((a2, b2) => b2.amountCents - a2.amountCents)[0];
            const topCat = top ? cats.find((k) => k.id === top.categoryId) : undefined;
            const pctCmp = prevCount ? Math.round(((n - prevCount) / prevCount) * 100) : null;
            const cmp = pctCmp === null ? null : <span className={'fx-chip ' + (pctCmp > 0 ? 'warn' : pctCmp < 0 ? 'good' : 'neutral')} title={period === 'month' ? 'vs mês anterior' : 'vs ano anterior'}>{pctCmp > 0 ? '+' : ''}{pctCmp}% <small>{period === 'month' ? 'vs mês ant.' : 'vs ano ant.'}</small></span>;
            return (
              <div className="txs-stats">
                <div><small>{period === 'month' ? 'Transações no mês' : 'Transações no ano'}</small><span className="txs-v"><b>{n}</b>{cmp}</span></div>
                <div><small>{period === 'month' ? 'Média por dia' : 'Média por mês'}</small><span className="txs-v"><b>{avg.toLocaleString(settings.language, { maximumFractionDigits: 1 })}</b>{cmp}</span></div>
                <div className="wide"><small>Compra mais cara</small><b>{top ? <>{top.description || (topCat ? catLabel(t, topCat) : '')} · <span className="fx-neg">{money(top.amountCents)}</span></> : '—'}</b></div>
              </div>
            );
          })()}
          <label className="txs-search"><Ic d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={17} /><input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Procurar (ex.: Pingo Doce)" /></label>
          <section className="mv-card">
            <div className="mv-card-head"><h2>Movimentos</h2></div>
            {byDay.length === 0 && <EmptyHero icon="M4 7h13l-3-3M20 17H7l3 3" title={period === 'month' ? 'Sem movimentos neste mês' : 'Sem movimentos neste ano'} text="Quando gastares ou receberes dinheiro, regista aqui para saberes sempre para onde vai." examples={['🛒 Compras', '💡 Contas da casa', '💶 Salário']} />}
            {dayOnly && <button type="button" className="txs-daychip" onClick={() => setDayOnly(null)}>Só {new Date(dayOnly).toLocaleDateString(settings.language, { day: 'numeric', month: 'long' })} · ver o mês todo ✕</button>}
            {byDay.filter(([day]) => !dayOnly || day === dayOnly).map(([day, g]) => (
              <div key={day} className="sh-day">
                <div className="sh-dayhead"><b>{new Date(day).toLocaleDateString(settings.language, { weekday: 'short', day: 'numeric', month: 'short' })}</b></div>
                {g.txs.map((x) => { const c = cats.find((k) => k.id === x.categoryId); return (
                  <div key={x.id}>
                    <button type="button" className="sh-tx txs-row" onClick={() => setOpenRow(openRow === x.id ? null : x.id)}>
                      <CatIcon cat={c ?? {}} size={36} />
                      <span className="sh-tx-main"><b>{x.description || (c ? catLabel(t, c) : '')}</b><small>{c ? catLabel(t, c) : ''}</small></span>
                      <b className={x.type === 'income' ? 'fx-pos' : 'fx-neg'}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</b>
                    </button>
                    {openRow === x.id && <div className="txs-actions"><button type="button" className="sh-danger" onClick={() => { if (window.confirm('Apagar este movimento?')) { remove(x.id); setOpenRow(null); } }}>Apagar</button></div>}
                  </div>
                ); })}
                {g.trs.map((tr) => (
                  <div key={tr.id} className="sh-tx">
                    <span className="txs-tric"><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={17} /></span>
                    <span className="sh-tx-main"><b>{tr.note || 'Transferência'}</b><small>{nameOf(tr.fromAccountId)} → {nameOf(tr.toAccountId)}</small></span>
                    <b>{money(tr.amountCents)}</b>
                  </div>
                ))}
              </div>
            ))}
          </section>
        </div>
      )}
      <PageHead title={t('transactions.title')} sub={t('transactions.subtitle')}>
        <AccountSwitch accounts={accounts} active={active} onChange={setActive} />
        <button type="button" className="fx-btn primary" onClick={openNew}><Ic d={ICON.plus} size={16} />{t('transactions.new')}</button>
      </PageHead>

      {!SIMPLE_UI && <div className="fx-kpis">
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.incomes')}</div><div className="fx-kpi-value"><span className="fx-pos">{money(income)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.expenses')}</div><div className="fx-kpi-value"><span>{money(expense)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.balance')}</div><div className="fx-kpi-value"><span className={income - expense < 0 ? 'fx-neg' : ''}>{money(income - expense)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.count')}</div><div className="fx-kpi-value"><span>{visible.length}</span></div></div>
      </div>}

      <div className="fx-toolbar tx-toolbar">
        <div className="fx-seg" role="group" aria-label={t('panel.period')}>
          <button type="button" className={period === 'month' ? 'on' : ''} aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>{t('panel.periodMonth')}</button>
          <button type="button" className={period === 'year' ? 'on' : ''} aria-pressed={period === 'year'} onClick={() => setPeriod('year')} data-testid="tx-period-year">{t('panel.periodYear')}</button>
        </div>
        <MonthNav label={period === 'month' ? `${monthNames[month - 1]} ${year}` : String(year)} onPrev={() => shift(-1)} onNext={() => shift(1)} />
        <Seg value={kind} onChange={setKind} label={t('transactions.type')}
          options={[{ id: 'all', label: t('transactions.all') }, { id: 'expense', label: t('transactions.typeExpense') }, { id: 'income', label: t('transactions.typeIncome') }]} />
        <CategorySelect className="fx-input pill" ariaLabel={t('transactions.filterCategory')} cats={cats} value={filterCat} onChange={setFilterCat} emptyLabel={t('transactions.allCategories')} />
        <div className="fx-search"><Ic d={ICON.search} size={16} /><input value={filterText} placeholder={t('transactions.search')} onChange={(e) => setFilterText(e.target.value)} aria-label={t('transactions.search')} /></div>
      </div>

      {byDay.length === 0 ? (
        <div className="fx-card"><EmptyState icon={ICON.wallet} title={period === 'year' ? t('transactions.emptyYear') : t('transactions.empty')} sub={t('transactions.emptySub')}
          action={<button type="button" className="fx-btn primary" onClick={openNew}><Ic d={ICON.plus} size={16} />{t('transactions.new')}</button>} /></div>
      ) : (
        <div className="fx-days">
          {byDay.map(([d, { txs: rows, trs }], di) => {
            // cartão "Patrocinado" uma só vez, depois do dia em que se passam os 15 movimentos
            const before = byDay.slice(0, di).reduce((n, [, v]) => n + v.txs.length + v.trs.length, 0);
            const adHere = before < 15 && before + rows.length + trs.length >= 15;
            const dayNet = rows.reduce((s, x) => s + (x.type === 'income' ? x.amountCents : -x.amountCents), 0);
            return (
              <Fragment key={d}>
              <div className="fx-card">
                <div className="fx-card-head"><h2>{dayLabel(d)}</h2><span className={'fx-num ' + (dayNet < 0 ? '' : 'fx-pos')}>{money(dayNet)}</span></div>
                <div className="fx-list">
                  {rows.map((x) => {
                    const c = cats.find((k) => k.id === x.categoryId);
                    const color = c?.color || COLORS[0];
                    return (
                      <div className="fx-item" key={x.id}>
                        {c ? <CatIcon cat={c} size={36} /> : <div className="fx-avatar" style={{ background: color, color: '#fff' }}>?</div>}
                        <div className="fx-item-main"><b>{x.description || (c ? catLabel(t, c) : '')}</b><span>{c ? catLabel(t, c) : ''}{x.groupId ? ' · ' + (groups.find((g) => g.id === x.groupId)?.name ?? '') : ''}</span></div>
                        <span className={'fx-num ' + (x.type === 'income' ? 'fx-pos' : '')}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents, x.currency)}</span>
                        <button type="button" className="fx-round sm" onClick={() => remove(x.id)} aria-label={t('common.delete')}><Ic d={ICON.trash} size={15} /></button>
                      </div>
                    );
                  })}
                  {trs.map((tr) => {
                    const out = active !== ALL_ACCOUNTS && tr.fromAccountId === active;
                    const into = active !== ALL_ACCOUNTS && tr.toAccountId === active;
                    return (
                      <div className="fx-item" key={tr.id} data-testid="transfer-row">
                        <div className="fx-avatar"><Ic d={ICON.repeat} size={16} /></div>
                        <div className="fx-item-main"><b>{nameOf(tr.fromAccountId)} → {nameOf(tr.toAccountId)}</b><span>{t('transactions.transfer')}{tr.note ? ' · ' + tr.note : ''}</span></div>
                        <span className={'fx-num ' + (into ? 'fx-pos' : '')}>{out ? '−' : into ? '+' : ''}{money(tr.amountCents)}</span>
                        <button type="button" className="fx-round sm" onClick={() => removeTr(tr.id)} aria-label={t('common.delete')}><Ic d={ICON.trash} size={15} /></button>
                      </div>
                    );
                  })}
                </div>
              </div>
              {adHere && <Sponsored place="transactions" />}
              </Fragment>
            );
          })}
        </div>
      )}

      <Sheet open={open} onClose={() => { setOpen(false); setToAccount(''); }} title={toAccount ? 'Transferência' : t('transactions.addTransaction')}
        footer={SIMPLE_UI && isMobile
          ? <button type="button" className="tx-addbtn" onClick={submit}>{toAccount ? 'Transferir' : type === 'expense' ? 'Adicionar despesa' : 'Adicionar rendimento'}</button>
          : <><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={submit}>{t('common.add')}</button></>}>
        {error && <p className="fx-error">{error}</p>}
        {SIMPLE_UI && isMobile ? (<>
          {/* Formulário (telemóvel): valor grande e linhas com ícone */}
          <div className="tx-seg"><Seg value={type} onChange={setType} label={t('transactions.type')} options={[{ id: 'expense', label: t('transactions.typeExpense') }, { id: 'income', label: t('transactions.typeIncome') }]} /></div>
          <input className={'tx-amt ' + (type === 'expense' ? 'exp' : 'inc')} autoFocus inputMode="decimal" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)} aria-label={t('transactions.amount')} />
          <span className="tx-cur">{settings.currency}</span>
          <div className="tx-rows">
            <div className="tx-row"><span><Ic d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" size={18} />{t('transactions.category')}</span>
              {toAccount ? <span className="tx-muted">Transferência</span> : <CategorySelect cats={cats} kind={type} value={categoryId} onChange={setCategoryId} ariaLabel={t('transactions.category')} className="fx-input tx-val" />}</div>
            <label className="tx-row"><span><Ic d="M4 20h4L19 9l-4-4L4 16z" size={18} />{t('transactions.description')}</span>
              <input className="tx-val" value={description} placeholder="Opcional" onChange={(e) => setDescription(e.target.value)} /></label>
            <div className="tx-row tx-acc"><span><Ic d={ICON.wallet} size={18} />{toAccount ? 'Da conta' : t('accounts.account')}</span>
              <span className="tx-accval">
                <span className="tx-accpick">
                  <select className="tx-val" value={accountId} onChange={(e) => { setAccountId(e.target.value); if (e.target.value === toAccount) setToAccount(''); }} aria-label={t('accounts.account')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                  {bals[accountId] !== undefined && <small className={bals[accountId] < 0 ? 'fx-neg' : 'fx-pos'}>{money(bals[accountId])}</small>}
                  {!toAccount && <button type="button" className="tx-swapmini" onClick={() => (accounts.length > 1 ? setToAccount(accounts.find((a) => a.id !== accountId)?.id ?? '') : setError('Para transferir, cria primeiro outra conta (ex.: Poupanças) em Contas.'))}><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={13} />Transferir para outra conta</button>}
                </span>
              </span></div>
            {toAccount && (
              <div className="tx-row tx-acc"><span><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={18} />Para a conta</span>
                <span className="tx-accval">
                  <span className="tx-accpick">
                    <select className="tx-val" value={toAccount} onChange={(e) => setToAccount(e.target.value)} aria-label="Para a conta">{accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                    {bals[toAccount] !== undefined && <small className={bals[toAccount] < 0 ? 'fx-neg' : 'fx-pos'}>{money(bals[toAccount])}</small>}
                  </span>
                  <button type="button" className="tx-swap off" onClick={() => setToAccount('')} aria-label="Cancelar transferência"><Ic d={ICON.close} size={16} /></button>
                </span></div>
            )}
            <div className="tx-row"><span><Ic d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4" size={18} />{t('transactions.date')}</span>
              <DatePicker value={date} onChange={setDate} ariaLabel={t('transactions.date')} testId="tx-date" /></div>
            {!toAccount && groups.length > 0 && <label className="tx-row"><span><Ic d="M4 6h16M4 12h16M4 18h10" size={18} />Grupo</span>
              <select className="tx-val" value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">Nenhum</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
            {<div className="tx-row"><span><Ic d="M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a5 5 0 1 0 1 6" size={18} />{toAccount ? 'Repetir todos os meses' : 'Recorrente'}</span>
              <button type="button" role="switch" aria-checked={recurring} className={'ob-toggle' + (recurring ? ' on' : '')} onClick={() => setRecurring(!recurring)} aria-label={t('transactions.recurring')}><i /></button></div>}
            {recurring && (<>
              <label className="tx-row tx-sub"><span>{t('goals.frequency')}</span>
                <select className="tx-val" value={freq} onChange={(e) => setFreq(e.target.value as RecurringFrequency)}>
                  {RECURRING_FREQUENCIES.map((f) => <option key={f} value={f}>{t('goals.' + f)}</option>)}
                </select></label>
              <div className="tx-row tx-sub"><span>Termina em</span>
                <DatePicker value={endDate} onChange={setEndDate} allowEmpty ariaLabel={t('transactions.recurringEnd')} /></div>
            </>)}
          </div>
        </>) : (<>
        <Seg value={type} onChange={setType} label={t('transactions.type')} options={[{ id: 'expense', label: t('transactions.typeExpense') }, { id: 'income', label: t('transactions.typeIncome') }]} />
        <Field label={t('transactions.amount')}><input className="fx-input big" autoFocus inputMode="decimal" value={amount} placeholder="0,00" onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('transactions.description')}><input className="fx-input" value={description} placeholder={t('transactions.descriptionPlaceholder')} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="fx-two">
          <Field label={t('transactions.category')}>
            <CategorySelect cats={cats} kind={type} value={categoryId} onChange={setCategoryId} ariaLabel={t('transactions.category')} />
          </Field>
          <Field label={t('transactions.date')}><DatePicker value={date} onChange={setDate} ariaLabel={t('transactions.date')} testId="tx-date" /></Field>
        </div>
        {isMobile && !moreOpts ? (
          <button type="button" className="tx-moreopts" onClick={() => setMoreOpts(true)}>+ {t('mobile.moreOptions')}</button>
        ) : (<>
          <div className="fx-two">
            <Field label={t('accounts.account')}>
              <select className="fx-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </Field>
            <Field label={t('goals.groupName')}>
              <select className="fx-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">—</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            </Field>
          </div>
          <Toggle on={recurring} onChange={setRecurring} label={t('transactions.recurring')} hint={t('transactions.recurringHint')} />
          {recurring && (
            <div className="fx-two">
              <Field label={t('goals.frequency')}>
                <select className="fx-input" value={freq} onChange={(e) => setFreq(e.target.value as RecurringFrequency)}>
                  {RECURRING_FREQUENCIES.map((f) => <option key={f} value={f}>{t('goals.' + f)}</option>)}
                </select>
              </Field>
              <Field label={t('transactions.recurringEnd')}>
                <DatePicker value={endDate} onChange={setEndDate} allowEmpty ariaLabel={t('transactions.recurringEnd')} />
              </Field>
            </div>
          )}
        </>)}
        </>)}
      </Sheet>
    </div>
  );
}
