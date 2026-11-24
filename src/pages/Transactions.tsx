import { AddTile } from '../ui/EmptyState';
import type { Goal } from '../db/database';
import { openImport } from '../ui/ImportHost';
import { CountMoney } from '../ui/CountMoney';
import { markPeriodChange } from '../ui/rollGate';
import { CountText } from '../ui/CountText';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { appConfirm } from '../ui/confirm';
import { useTranslation } from 'react-i18next';
import { GTile } from './Split';
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

const fill = (x: string, v: Record<string, string>) => x.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

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
  const [goalsL, setGoalsL] = useState<Goal[]>([]); // registos de dinheiro posto nas metas
  const [kind, setKind] = useState<'all' | 'expense' | 'income'>('all');
  const [filterCat, setFilterCat] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('categoria') ?? ''); // ?categoria=<id>: vindo de uma sugestão do Planeamento
  const [filterText, setFilterText] = useState('');
  // ?conta=<id>: vindo de uma meta/dívida, mostra só o dinheiro que entrou nessa conta (todas as datas)
  const [onlyAcc, setOnlyAcc] = useState<string | null>(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('conta'));

  const refresh = async () => {
    // tudo lido ao mesmo tempo (a página abre mais depressa)
    const [rows, cs, gs, trs] = await Promise.all([filterTransactions(db, { categoryId: filterCat || undefined, text: filterText }), activeCategories(db), listGroups(db), loadTransfers(db)]);
    setGoalsL((await db.goals.toArray()).filter((x) => x.deletedAt === null && (x.contributions ?? []).length > 0));
    setTxs(onlyAcc ? rows : rows.filter((x) => x.date >= range.from && x.date <= range.to));
    setCats(cs); setGroups(gs); setTransfers(trs);
    setReady(true);
  };
  useEffect(() => { refresh().catch(() => setReady(true)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.from, range.to, filterCat, filterText, onlyAcc]);

  const visible = useMemo(
    () => (onlyAcc ? txs.filter((x) => x.accountId === onlyAcc && x.type === 'income') : txsOfAccount(txs, active, accounts)).filter((x) => kind === 'all' || x.type === kind).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [txs, active, accounts, kind, onlyAcc],
  );
  const money = (c: number, cur = settings.currency) => formatMoney(c, cur, settings.language);
  const income = visible.filter((x) => x.type === 'income').reduce((s, x) => s + x.amountCents, 0);
  const expense = visible.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amountCents, 0);

  // Transferências entre contas também aparecem na lista (não contam como rendimento nem despesa).
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
  const visibleTransfers = useMemo(() => {
    if (onlyAcc) return transfers.filter((tr) => tr.toAccountId === onlyAcc);
    if (kind !== 'all' || filterCat) return [];
    const q = filterText.trim().toLowerCase();
    return transfers.filter((tr) => tr.date >= range.from && tr.date <= range.to
      && (active === ALL_ACCOUNTS || tr.fromAccountId === active || tr.toAccountId === active)
      && (!q || `${tr.note} ${nameOf(tr.fromAccountId)} ${nameOf(tr.toAccountId)}`.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfers, range.from, range.to, active, kind, filterCat, filterText, accounts, onlyAcc]);

  const byDay = useMemo(() => {
    const m = new Map<string, { txs: Transaction[]; trs: Transfer[]; gls: Array<{ key: string; name: string; cents: number; acc?: string; note?: string }> }>();
    const get = (d: string) => m.get(d) ?? m.set(d, { txs: [], trs: [], gls: [] }).get(d)!;
    for (const x of visible) get(x.date).txs.push(x);
    for (const tr of visibleTransfers) get(tr.date).trs.push(tr);
    if (!onlyAcc && !filterCat && kind !== 'income' && !filterText.trim()) for (const g of goalsL) (g.contributions ?? []).forEach((c, i) => { if (c.date >= range.from && c.date <= range.to && (active === ALL_ACCOUNTS || (c.accountId ?? g.accountIds?.[0]) === active)) get(c.date).gls.push({ key: g.id + i, name: g.name, cents: c.cents, acc: c.accountId ?? g.accountIds?.[0], note: c.note }); });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible, visibleTransfers, goalsL, range.from, range.to, active, kind, onlyAcc, filterCat, filterText]); // eslint-disable-line react-hooks/exhaustive-deps

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
    openTxForm({ type: params.get('tipo') === 'income' ? 'income' : 'expense', accountId: active !== ALL_ACCOUNTS ? active : undefined, groupId: params.get('grupo') ?? undefined, toAccount: params.get('para') ?? undefined, description: params.get('desc') ?? undefined });
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const remove = async (id: string) => { await softDelete(db, 'transactions', id); await refresh(); };
  const dayLabel = (d: string) => new Intl.DateTimeFormat(settings.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00'));

  const [openRow, setOpenRow] = useState<string | null>(null);
  // Nº de transações do período anterior (mês ou ano), para a comparação em %
  const [prevCount, setPrevCount] = useState<number | null>(null);
  const [ready, setReady] = useState(false); // só mostra a página quando os dados chegam (sem números a 0 que depois saltam)
  // espera um instante depois dos dados (outros valores ainda se acertam) e só então mostra a página, de uma vez
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!(ready && accounts.length > 0) || shown) return; const id = setTimeout(() => setShown(true), 0); return () => clearTimeout(id); }, [ready, accounts.length, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastPct = useRef<number | null>(null); // a percentagem anterior fica à vista até chegar a nova (sem desaparecer e voltar)
  useEffect(() => {
    const pr = previousRange(per);
    filterTransactions(db, {}).then((r) => setPrevCount(txsOfAccount(r.filter((x) => x.date >= pr.from && x.date <= pr.to), active, accounts).filter((x) => kind === 'all' || x.type === kind).length)).catch(() => setPrevCount(null));
  }, [range.from, range.to, kind, active, accounts]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [dayOnly, setDayOnly] = useState<string | null>(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('dia'));
  const simple = SIMPLE_UI && isMobile;

  return (
    <div className={'fx-page' + (simple ? ' tx-simple' : '') + (shown ? ' pg-ready' : ' pg-wait')}>
      {simple && (
        <div className="txs-new mv sh">
          {/* Transações (telemóvel): só a lista completa, com filtros simples */}
          <header className="mv-head gpz-head"><h1 className="sh-title">{t('txs.title')}</h1><span className="pg-acts"><button type="button" className="imp-chip txs-imp" onClick={openImport} title={L('Junta várias despesas de uma vez, sem escrever uma a uma')}><span className="imp-chip-ic"><Ic d="M12 3v12M7 10l5 5 5-5M5 21h14" size={15} /></span>{L('Importar extrato')}</button></span></header>
          <PeriodFilter value={per} onChange={setPer} />
          <AddTile cls="txs-addtile" label={t('txs.new')} onClick={openNew} />
          {(() => {
            const kinds = [
              { id: 'all' as const, label: t('txs.all'), d: 'M4 7h13l-3-3M20 17H7l3 3', n: txsOfAccount(txs, active, accounts).length },
              { id: 'expense' as const, label: t('txs.expenses'), d: 'M12 5v14M5 12l7 7 7-7', n: txsOfAccount(txs, active, accounts).filter((x) => x.type === 'expense').length },
              { id: 'income' as const, label: t('txs.incomes'), d: 'M12 19V5M5 12l7-7 7 7', n: txsOfAccount(txs, active, accounts).filter((x) => x.type === 'income').length },
            ];
            return (
              <div className={'acc-seg txk-seg t-' + kind} role="tablist" style={{ ['--i' as string]: kinds.findIndex((k) => k.id === kind) }}>
                <span className="acc-seg-pill" aria-hidden="true" />
                {kinds.map((k) => <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} className={'t-' + k.id + (kind === k.id ? ' on' : '')} onClick={() => { markPeriodChange(); setKind(k.id); }}><span className="acc-seg-ic"><Ic d={k.d} size={17} /></span>{k.label}{k.n > 0 && <em>{k.n}</em>}</button>)}
              </div>
            );
          })()}
          <label className="txs-search"><Ic d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={17} /><input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder={t('txs.search')} /></label>
          {(() => {
            const n = visible.length;
            const nowD = new Date();
            const isCur = year === nowD.getFullYear();
            const span = period === 'year' ? (isCur ? nowD.getMonth() + 1 : 12) : 1;
            const avg = span > 0 ? n / span : 0;
            const top = visible.filter((x) => x.type === 'expense').sort((a2, b2) => b2.amountCents - a2.amountCents)[0];
            const topCat = top ? cats.find((k) => k.id === top.categoryId) : undefined;
            const fresh = prevCount ? Math.round(((n - prevCount) / prevCount) * 100) : null;
            if (fresh !== null) lastPct.current = fresh;
            const pctCmp = fresh ?? lastPct.current;
            const today = nowD.toISOString().slice(0, 10), rTo = range.to < today ? range.to : today;
            const days = period === 'range' ? Math.max(1, Math.round((new Date(rTo + 'T12:00:00').getTime() - new Date(range.from + 'T12:00:00').getTime()) / 864e5) + 1) : period === 'year' ? (isCur ? Math.max(1, Math.round((nowD.getTime() - new Date(year, 0, 1).getTime()) / 864e5) + 1) : (year % 4 === 0 ? 366 : 365))
              : (year === nowD.getFullYear() && month === nowD.getMonth() + 1 ? nowD.getDate() : new Date(year, month, 0).getDate());
            const perDay = n / Math.max(1, days);
            const prevLabel = period === 'year' ? String(year - 1) : new Date(year, month - 2, 1).toLocaleDateString(settings.language, { month: 'long' });
            const nExp = visible.filter((x) => x.type === 'expense').length, nInc = visible.filter((x) => x.type === 'income').length;
            const fmtD = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(settings.language, { day: 'numeric', month: 'short' });
            return (<>
              {period === 'range' && <div className={'txs-range' + (kind === 'all' ? ' two' : '')} key={'r' + kind + range.from + range.to}>
                {kind !== 'income' && <div className="txs-rbox exp" style={{ ['--i' as string]: 0 }}><span className="txs-ric"><Ic d="M12 5v14M5 12l7 7 7-7" size={18} /></span><div><small><span className="txs-rl">{L('Gastaste em despesas')}</span><span className="txs-rs">{L('Gastaste')}</span></small><b><CountMoney cents={expense} money={money} /></b><em>{fill(L('{n} despesas · {a} a {b}'), { n: String(nExp), a: fmtD(range.from), b: fmtD(range.to) })}</em></div></div>}
                {kind !== 'expense' && <div className="txs-rbox inc" style={{ ['--i' as string]: 1 }}><span className="txs-ric"><Ic d="M12 19V5M5 12l7-7 7 7" size={18} /></span><div><small><span className="txs-rl">{L('Recebeste em rendimentos')}</span><span className="txs-rs">{L('Recebeste')}</span></small><b><CountMoney cents={income} money={money} /></b><em>{fill(L('{n} rendimentos · {a} a {b}'), { n: String(nInc), a: fmtD(range.from), b: fmtD(range.to) })}</em></div></div>}
                <div className="txs-rfoot">{kind === 'all' && <span className="txs-rbar" aria-hidden="true"><i style={{ width: `${expense + income > 0 ? (expense / (expense + income)) * 100 : 50}%` }} /></span>}
                  <small>{kind === 'all' ? <>{L('Saldo do período')} <b className={income - expense >= 0 ? 'fx-pos' : 'fx-neg'}>{income - expense >= 0 ? '+' : '−'}{money(Math.abs(income - expense))}</b> · </> : null}{fmtD(range.from)} – {fmtD(range.to)}</small></div>
              </div>}
              <div className="gx-tiles even txs-tiles three">
                <div className="gx-tile txs-cnt"><span aria-hidden="true"><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={20} /></span><div><small>{t('txs.count_' + period)}</small>
                  <span className="txs-v"><b><CountText text={String(n)} /></b>{<span style={{ opacity: pctCmp ? 1 : 0, transition: 'opacity .45s ease, background-color .45s ease, color .45s ease' }} className={'fx-chip ' + ((pctCmp ?? 0) > 0 ? 'warn' : (pctCmp ?? 0) < 0 ? 'good' : 'neutral')} title={`${t('pco.vs')} ${prevLabel}`}><CountText text={`${pctCmp ?? 0}%`} /> <small>{t('txs.vsShort_' + period)}</small></span>}</span></div></div>
                {period === 'year' && <GTile d="M5 5h14v15H5zM5 10h14M8 3v4M16 3v4" label={L('Transações por mês (média)')} value={avg.toLocaleString(settings.language, { maximumFractionDigits: 1 })} />}
                {period !== 'year' && <GTile d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2" label={L('Transações por dia (média)')} value={perDay.toLocaleString(settings.language, { maximumFractionDigits: 1 })} />}
                <div className={'gx-tile txs-top' + (top ? ' neg' : '')}><span aria-hidden="true"><Ic d="M12 19V5M5 12l7-7 7 7" size={20} /></span><div><small>{t('txs.biggest')}</small>{top && <em className="txs-topn">{top.description || (topCat ? catLabel(t, topCat) : '')}</em>}<b><CountMoney cents={top ? top.amountCents : 0} money={money} /></b></div></div>
              </div>
            </>);
          })()}
          <section className="mv-card">
            <div className="mv-card-head"><h2>{t('txs.list')}</h2></div>
            {byDay.length === 0 && <EmptyHero icon="M4 7h13l-3-3M20 17H7l3 3" title={t('txs.empty_' + period)} text={t('txs.emptyText')} examples={[t('txs.ex1'), t('txs.ex2'), t('txs.ex3')]} />}
            {onlyAcc && <button type="button" className="txs-daychip txs-accchip" onClick={() => setOnlyAcc(null)}>{L('Só')}: {nameOf(onlyAcc)} ✕</button>}
            {dayOnly && <button type="button" className="txs-daychip" onClick={() => setDayOnly(null)}>{t('txs.onlyDay', { day: new Date(dayOnly).toLocaleDateString(settings.language, { day: 'numeric', month: 'long' }) })}</button>}
            {byDay.filter(([day]) => !dayOnly || day === dayOnly).map(([day, g], di, arr) => (
              <Fragment key={day}>
              {new Set(arr.map(([d2]) => d2.slice(0, 7))).size > 1 && (di === 0 || arr[di - 1][0].slice(0, 7) !== day.slice(0, 7)) && <div className="txs-month"><span>{new Date(day.slice(0, 7) + '-01T12:00:00').toLocaleDateString(settings.language, { month: 'long', year: 'numeric' })}</span></div>}
              <div className="sh-day">
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
                {g.gls.map((x) => (
                  <div key={x.key} className="sh-tx txs-goal">
                    <span className="txs-tric goal"><Ic d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" size={17} /></span>
                    <span className="sh-tx-main"><b>{x.note || (x.cents >= 0 ? fill(L('Reservado para a meta {n}'), { n: x.name }) : fill(L('Tirado da meta {n}'), { n: x.name }))}</b><small>{L('Meta')} · {x.name}{x.acc ? ' · ' + nameOf(x.acc) : ''}</small></span>
                    <b className="txs-goalv">{x.cents >= 0 ? '' : '−'}{money(Math.abs(x.cents))}</b>
                  </div>
                ))}
                {g.trs.map((tr) => (
                  <div key={tr.id} className="sh-tx">
                    <span className="txs-tric"><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={17} /></span>
                    <span className="sh-tx-main"><b>{tr.note || L('Transferência')}</b><small>{nameOf(tr.fromAccountId)} → {nameOf(tr.toAccountId)}</small></span>
                    <b>{money(tr.amountCents)}</b>
                  </div>
                ))}
              </div>
              </Fragment>
            ))}
          </section>
        </div>
      )}
      <PageHead title={t('transactions.title')}>
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
