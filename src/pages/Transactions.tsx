import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { db } from '../db/app-db';
import type { Transaction, Transfer, Category, Group, RecurringFrequency } from '../db/database';
import { addTransaction, addRecurring, materializeDueRecurrings, RECURRING_FREQUENCIES, softDelete, activeCategories, filterTransactions, listGroups } from '../core/finance';
import { txsOfAccount, defaultAccountId, ALL_ACCOUNTS, loadTransfers, removeTransfer } from '../core/accounts';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { catLabel, PageHead, Seg, Sheet, Toggle, Field, MonthNav, EmptyState, AccountSwitch, Ic, ICON, useAccounts } from '../ui/fx';
import { todayISO } from '../core/dates';

const COLORS = ['#8b7cf6', '#5fd4c4', '#e58fd3', '#f5b85a', '#60a5fa', '#4ade9b', '#f87171'];

export function Transactions() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
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
    const rows = await filterTransactions(db, { year, month, categoryId: filterCat || undefined, text: filterText });
    setTxs(rows);
    const cs = await activeCategories(db);
    setCats(cs);
    setGroups(await listGroups(db));
    setTransfers(await loadTransfers(db));
    setCategoryId((cur) => cur || cs[0]?.id || '');
  };
  useEffect(() => { refresh().catch((e) => setError(String(e))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year, month, filterCat, filterText]);

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
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const q = filterText.trim().toLowerCase();
    return transfers.filter((tr) => tr.date.startsWith(prefix)
      && (active === ALL_ACCOUNTS || tr.fromAccountId === active || tr.toAccountId === active)
      && (!q || `${tr.note} ${nameOf(tr.fromAccountId)} ${nameOf(tr.toAccountId)}`.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfers, year, month, active, kind, filterCat, filterText, accounts]);

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
    let m = month + d, y = year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };

  const openNew = () => {
    setError(null); setAmount(''); setDescription('');
    setAccountId(active !== ALL_ACCOUNTS ? active : defaultAccountId(accounts) ?? '');
    setOpen(true);
  };

  // O botão "+" do telemóvel abre esta página com ?nova=1 -> abre logo o formulário.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('nova') && accounts.length > 0) {
      openNew();
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, accounts.length]);

  const submit = async () => {
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) { setError(t('transactions.amountInvalid')); return; }
    if (!categoryId) { setError(t('transactions.pickCategory')); return; }
    try {
      if (recurring) {
        if (endDate && endDate < date) { setError(t('transactions.endBeforeStart')); return; }
        // A recorrente gera a 1.ª ocorrência (se a data já chegou) e as seguintes quando vencerem.
        await addRecurring(db, { type, categoryId, description: description.trim(), amountCents: cents, currency: settings.currency, frequency: freq, nextDate: date, endDate: endDate || null, accountId: accountId || undefined });
        await materializeDueRecurrings(db, todayISO());
      } else {
        await addTransaction(db, { date, type, categoryId, description: description.trim(), amountCents: cents, currency: settings.currency, groupId: groupId || undefined, accountId: accountId || undefined });
      }
      setRecurring(false); setEndDate(''); setAmount(''); setDescription('');
      setOpen(false);
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const remove = async (id: string) => { await softDelete(db, 'transactions', id); await refresh(); };
  const dayLabel = (d: string) => new Intl.DateTimeFormat(settings.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00'));

  return (
    <div className="fx-page">
      <PageHead title={t('transactions.title')} sub={t('transactions.subtitle')}>
        <AccountSwitch accounts={accounts} active={active} onChange={setActive} />
        <button type="button" className="fx-btn primary" onClick={openNew}><Ic d={ICON.plus} size={16} />{t('transactions.new')}</button>
      </PageHead>

      <div className="fx-kpis">
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.incomes')}</div><div className="fx-kpi-value"><span className="fx-pos">{money(income)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.expenses')}</div><div className="fx-kpi-value"><span>{money(expense)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.balance')}</div><div className="fx-kpi-value"><span className={income - expense < 0 ? 'fx-neg' : ''}>{money(income - expense)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.count')}</div><div className="fx-kpi-value"><span>{visible.length}</span></div></div>
      </div>

      <div className="fx-toolbar">
        <MonthNav label={`${monthNames[month - 1]} ${year}`} onPrev={() => shift(-1)} onNext={() => shift(1)} />
        <Seg value={kind} onChange={setKind} label={t('transactions.type')}
          options={[{ id: 'all', label: t('transactions.all') }, { id: 'expense', label: t('transactions.typeExpense') }, { id: 'income', label: t('transactions.typeIncome') }]} />
        <select className="fx-input pill" aria-label={t('transactions.filterCategory')} value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="">{t('transactions.allCategories')}</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{catLabel(t, c)}</option>)}
        </select>
        <div className="fx-search"><Ic d={ICON.search} size={16} /><input value={filterText} placeholder={t('transactions.search')} onChange={(e) => setFilterText(e.target.value)} aria-label={t('transactions.search')} /></div>
      </div>

      {byDay.length === 0 ? (
        <div className="fx-card"><EmptyState icon={ICON.wallet} title={t('transactions.empty')} sub={t('transactions.emptySub')}
          action={<button type="button" className="fx-btn primary" onClick={openNew}><Ic d={ICON.plus} size={16} />{t('transactions.new')}</button>} /></div>
      ) : (
        <div className="fx-days">
          {byDay.map(([d, { txs: rows, trs }]) => {
            const dayNet = rows.reduce((s, x) => s + (x.type === 'income' ? x.amountCents : -x.amountCents), 0);
            return (
              <div className="fx-card" key={d}>
                <div className="fx-card-head"><h2>{dayLabel(d)}</h2><span className={'fx-num ' + (dayNet < 0 ? '' : 'fx-pos')}>{money(dayNet)}</span></div>
                <div className="fx-list">
                  {rows.map((x) => {
                    const c = cats.find((k) => k.id === x.categoryId);
                    const color = c?.color || COLORS[0];
                    return (
                      <div className="fx-item" key={x.id}>
                        <div className="fx-avatar" style={{ background: color, color: '#fff' }}>{(c ? catLabel(t, c) : '?').charAt(0).toUpperCase()}</div>
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
            );
          })}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('transactions.addTransaction')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={submit}>{t('common.add')}</button></>}>
        {error && <p className="fx-error">{error}</p>}
        <Seg value={type} onChange={setType} label={t('transactions.type')} options={[{ id: 'expense', label: t('transactions.typeExpense') }, { id: 'income', label: t('transactions.typeIncome') }]} />
        <Field label={t('transactions.amount')}><input className="fx-input big" autoFocus inputMode="decimal" value={amount} placeholder="0,00" onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('transactions.description')}><input className="fx-input" value={description} placeholder={t('transactions.descriptionPlaceholder')} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="fx-two">
          <Field label={t('transactions.category')}>
            <select className="fx-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{catLabel(t, c)}</option>)}</select>
          </Field>
          <Field label={t('transactions.date')}><input className="fx-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
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
              <input className="fx-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        )}
      </Sheet>
    </div>
  );
}
