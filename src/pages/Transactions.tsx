import { Fragment, useEffect, useMemo, useState } from 'react';
import { appConfirm } from '../ui/confirm';
import { useTranslation } from 'react-i18next';
import { SIMPLE_UI } from '../core/uiMode';
import { EmptyState as EmptyHero } from '../ui/EmptyState';
import { useIsMobile } from '../ui/useIsMobile';
import { useSearchParams } from 'react-router-dom';
import { db } from '../db/app-db';
import type { Transaction, Transfer, Category, Group } from '../db/database';
import { softDelete, activeCategories, filterTransactions, listGroups } from '../core/finance';
import { txsOfAccount, ALL_ACCOUNTS, loadTransfers, removeTransfer } from '../core/accounts';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { catLabel, PageHead, Seg, MonthNav, EmptyState, AccountSwitch, Ic, ICON, useAccounts, CategorySelect, CatIcon } from '../ui/fx';
import { Sponsored } from '../ui/Sponsored';
import { PeriodFilter, initialPeriod, periodRange, previousRange, type Period } from '../ui/PeriodFilter';
import { openTxForm, useTxSaved } from '../ui/TxForm';
import { L } from '../i18n/phrases';

const COLORS = ['#8b7cf6', '#5fd4c4', '#e58fd3', '#f5b85a', '#60a5fa', '#4ade9b', '#f87171'];

export function Transactions() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const now = new Date();
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? ''); // vindo do Resumo: ?mes=2026-11 ou ?ano=2026
  const qm = /^(\d{4})-(\d{2})$/.exec(q.get('mes') ?? ''), qy = Number(q.get('ano')) || 0;
  const qde = q.get('de'), qate = q.get('ate'); // vindo do Resumo com um intervalo: ?de=2026-08-01&ate=2026-11-21
  const [per, setPer] = useState<Period>(() => {
    const b = initialPeriod(now);
    if (qde && qate) return { ...b, mode: 'range', preset: (['m1', 'q', 's'].includes(q.get('p') ?? '') ? q.get('p') : 'custom') as Period['preset'], from: qde, to: qate };
    return { ...b, mode: qy && !qm ? 'year' : 'month', y: qm ? +qm[1] : qy || now.getFullYear(), m: qm ? +qm[2] - 1 : now.getMonth() };
  });
  const year = per.y, month = per.m + 1, period = per.mode; // ver um mês, o ano inteiro ou um intervalo
  const range = periodRange(per);
  const setYear = (v: number | ((y: number) => number)) => setPer((p) => ({ ...p, y: typeof v === 'function' ? v(p.y) : v }));
  const setMonth = (v: number) => setPer((p) => ({ ...p, m: v - 1 }));
  const setPeriod = (v: 'month' | 'year') => setPer((p) => ({ ...p, mode: v }));
  const { accounts, active, setActive } = useAccounts();

  const [txs, setTxs] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [kind, setKind] = useState<'all' | 'expense' | 'income'>('all');
  const [filterCat, setFilterCat] = useState('');
  const [filterText, setFilterText] = useState('');

  const refresh = async () => {
    const rows = await filterTransactions(db, { categoryId: filterCat || undefined, text: filterText });
    setTxs(rows.filter((x) => x.date >= range.from && x.date <= range.to));
    const cs = await activeCategories(db);
    setCats(cs);
    setGroups(await listGroups(db));
    setTransfers(await loadTransfers(db));
  };
  useEffect(() => { refresh().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.from, range.to, filterCat, filterText]);

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
    const q = filterText.trim().toLowerCase();
    return transfers.filter((tr) => tr.date >= range.from && tr.date <= range.to
      && (active === ALL_ACCOUNTS || tr.fromAccountId === active || tr.toAccountId === active)
      && (!q || `${tr.note} ${nameOf(tr.fromAccountId)} ${nameOf(tr.toAccountId)}`.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfers, range.from, range.to, active, kind, filterCat, filterText, accounts]);

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
  const openNew = () => openTxForm({ type: 'expense', accountId: active !== ALL_ACCOUNTS ? active : undefined });
  useTxSaved(() => { refresh().catch(() => {}); });

  // O botão "+" do telemóvel abre esta página com ?nova=1 -> abre logo o formulário.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!params.get('nova')) return;
    openTxForm({ type: params.get('tipo') === 'income' ? 'income' : 'expense', accountId: active !== ALL_ACCOUNTS ? active : undefined, groupId: params.get('grupo') ?? undefined, toAccount: params.get('para') ?? undefined });
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const remove = async (id: string) => { await softDelete(db, 'transactions', id); await refresh(); };
  const dayLabel = (d: string) => new Intl.DateTimeFormat(settings.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00'));

  const [openRow, setOpenRow] = useState<string | null>(null);
  // Nº de transações do período anterior (mês ou ano), para a comparação em %
  const [prevCount, setPrevCount] = useState<number | null>(null);
  useEffect(() => {
    const pr = previousRange(per);
    filterTransactions(db, {}).then((r) => setPrevCount(txsOfAccount(r.filter((x) => x.date >= pr.from && x.date <= pr.to), active, accounts).filter((x) => kind === 'all' || x.type === kind).length)).catch(() => setPrevCount(null));
  }, [range.from, range.to, kind, active, accounts]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [dayOnly, setDayOnly] = useState<string | null>(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('dia'));
  const simple = SIMPLE_UI && isMobile;

  return (
    <div className={'fx-page' + (simple ? ' tx-simple' : '')}>
      {simple && (
        <div className="txs-new mv sh">
          {/* Transações (telemóvel): só a lista completa, com filtros simples */}
          <header className="mv-head"><h1 className="sh-title">{t('txs.title')}</h1></header>
          <button type="button" className="sh-btn in txs-add" onClick={openNew}><Ic d={ICON.plus} size={18} />{t('txs.new')}</button>
          <PeriodFilter value={per} onChange={setPer} />
          <div className="sh-seg small three" role="tablist">
            <button type="button" className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>{t('txs.all')}</button>
            <button type="button" className={kind === 'expense' ? 'on' : ''} onClick={() => setKind('expense')}>{t('txs.expenses')}</button>
            <button type="button" className={kind === 'income' ? 'on' : ''} onClick={() => setKind('income')}>{t('txs.incomes')}</button>
          </div>
          {(() => {
            const n = visible.length;
            const nowD = new Date();
            const isCur = year === nowD.getFullYear();
            const span = period === 'year' ? (isCur ? nowD.getMonth() + 1 : 12) : 1;
            const avg = span > 0 ? n / span : 0;
            const top = visible.filter((x) => x.type === 'expense').sort((a2, b2) => b2.amountCents - a2.amountCents)[0];
            const topCat = top ? cats.find((k) => k.id === top.categoryId) : undefined;
            const pctCmp = prevCount ? Math.round(((n - prevCount) / prevCount) * 100) : null;
            const cmp = pctCmp === null ? null : <span className={'fx-chip ' + (pctCmp > 0 ? 'warn' : pctCmp < 0 ? 'good' : 'neutral')} title={t('txs.vs_' + period)}>{pctCmp > 0 ? '+' : ''}{pctCmp}% <small>{t('txs.vsShort_' + period)}</small></span>;
            return (
              <div className="txs-stats">
                <div><small>{t('txs.count_' + period)}</small><span className="txs-v"><b>{n}</b>{cmp}</span></div>
                {period === 'year' && <div><small>{t('txs.avgMonth')}</small><span className="txs-v"><b>{avg.toLocaleString(settings.language, { maximumFractionDigits: 1 })}</b></span></div>}
                <div className="wide"><small>{t('txs.biggest')}</small><b>{top ? <>{top.description || (topCat ? catLabel(t, topCat) : '')} · <span className="fx-neg">{money(top.amountCents)}</span></> : '—'}</b></div>
              </div>
            );
          })()}
          <label className="txs-search"><Ic d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={17} /><input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder={t('txs.search')} /></label>
          <section className="mv-card">
            <div className="mv-card-head"><h2>{t('txs.list')}</h2></div>
            {byDay.length === 0 && <EmptyHero icon="M4 7h13l-3-3M20 17H7l3 3" title={t('txs.empty_' + period)} text={t('txs.emptyText')} examples={[t('txs.ex1'), t('txs.ex2'), t('txs.ex3')]} />}
            {dayOnly && <button type="button" className="txs-daychip" onClick={() => setDayOnly(null)}>{t('txs.onlyDay', { day: new Date(dayOnly).toLocaleDateString(settings.language, { day: 'numeric', month: 'long' }) })}</button>}
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
                    {openRow === x.id && <div className="txs-actions"><button type="button" className="sh-danger" onClick={async () => { if (await appConfirm(L('Apagar este movimento?'))) { remove(x.id); setOpenRow(null); } }}>{L('Apagar')}</button></div>}
                  </div>
                ); })}
                {g.trs.map((tr) => (
                  <div key={tr.id} className="sh-tx">
                    <span className="txs-tric"><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={17} /></span>
                    <span className="sh-tx-main"><b>{tr.note || L('Transferência')}</b><small>{nameOf(tr.fromAccountId)} → {nameOf(tr.toAccountId)}</small></span>
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

    </div>
  );
}
