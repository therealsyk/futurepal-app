import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, AccountType, Transaction, Transfer } from '../db/database';
import { addAccount, updateAccount, removeAccount, accountBalanceCents, netWorthCents, salariesUntil, CURRENCIES, loadTransfers, addTransfer, removeTransfer, suggestedSource, validateTransfer } from '../core/accounts';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageHead, Seg, Sheet, Toggle, Field, EmptyState, Ic, ICON, useAccounts } from '../ui/fx';
import type { Category } from '../db/database';
import { todayISO } from '../core/dates';

const TYPE_ICON: Record<AccountType, string> = { spending: ICON.wallet, savings: ICON.piggy, debt: ICON.debt };
const TYPE_COLOR: Record<AccountType, string> = { spending: 'var(--accent)', savings: 'var(--teal)', debt: 'var(--amber)' };

interface Draft {
  id: string | null; name: string; description: string; type: AccountType; currency: string; initial: string;
  includeInNetWorth: boolean; isDefault: boolean; showOnHome: boolean;
}

export function Accounts() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const { accounts, refresh } = useAccounts();
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [salaryCents, setSalaryCents] = useState(0);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [tdraft, setTdraft] = useState<{ from: string; to: string; amount: string; date: string; note: string; abate: boolean; categoryId: string } | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [terror, setTerror] = useState<string | null>(null);
  const [tab, setTab] = useState<AccountType>('spending');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setTxs((await db.transactions.toArray()).filter((x) => x.deletedAt === null));
    const now = new Date();
    setSalaryCents(salariesUntil(await db.salaries.toArray(), now.getFullYear(), now.getMonth() + 1));
    setTransfers(await loadTransfers(db));
    setCats((await db.categories.toArray()).filter((c) => c.deletedAt === null).sort((a, b) => a.order - b.order));
    await refresh();
  };
  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const money = (c: number, cur = settings.currency) => formatMoney(c, cur, settings.language);
  const bal = (a: Account) => accountBalanceCents(a, txs, accounts, salaryCents, transfers);

  const totals = useMemo(() => {
    const sum = (type: AccountType) => accounts.filter((a) => a.type === type).reduce((s, a) => s + bal(a), 0);
    return { net: netWorthCents(accounts, txs, salaryCents, transfers), spending: sum('spending'), savings: sum('savings'), debt: sum('debt') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, txs, salaryCents, transfers]);

  const shown = accounts.filter((a) => a.type === tab);

  const openNew = () => { setError(null); setDraft({ id: null, name: '', description: '', type: tab, currency: settings.currency, initial: '', includeInNetWorth: true, isDefault: false, showOnHome: true }); };
  const openEdit = (a: Account) => {
    setError(null);
    setDraft({ id: a.id, name: a.name, description: a.description, type: a.type, currency: a.currency, initial: (a.initialBalanceCents / 100).toString().replace('.', ','), includeInNetWorth: a.includeInNetWorth, isDefault: a.isDefault, showOnHome: a.showOnHome });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError(t('accounts.nameRequired')); return; }
    const initial = draft.initial.trim() === '' ? 0 : parseMoneyToCents(draft.initial.replace('-', ''));
    if (initial === null) { setError(t('accounts.balanceInvalid')); return; }
    const sign = draft.initial.trim().startsWith('-') ? -1 : 1;
    const payload = { name: draft.name, description: draft.description, type: draft.type, currency: draft.currency, initialBalanceCents: sign * initial, includeInNetWorth: draft.includeInNetWorth, isDefault: draft.isDefault, showOnHome: draft.showOnHome };
    if (draft.id) await updateAccount(db, draft.id, payload);
    else await addAccount(db, payload);
    setDraft(null);
    await load();
  };

  const today = () => todayISO();
  const openTransfer = (to?: Account) => {
    setTerror(null);
    const target = to ?? accounts.find((a) => a.type === 'debt') ?? accounts[1] ?? accounts[0];
    const src = target ? suggestedSource(accounts, target.id) : accounts[0];
    setTdraft({ from: src?.id ?? '', to: target?.id ?? '', amount: '', date: today(), note: '', abate: target?.type === 'debt' && !!to, categoryId: '' });
  };
  const saveTransfer = async () => {
    if (!tdraft) return;
    const cents = parseMoneyToCents(tdraft.amount);
    const input = { fromAccountId: tdraft.from, toAccountId: tdraft.to, amountCents: cents ?? 0, date: tdraft.date, note: tdraft.note, categoryId: tdraft.categoryId || null };
    const err = validateTransfer(input, accounts);
    if (err) { setTerror(t('accounts.err_' + err)); return; }
    await addTransfer(db, input);
    setTdraft(null);
    await load();
  };
  const delTransfer = async (id: string) => { await removeTransfer(db, id); await load(); };
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '—';
  const tTarget = tdraft ? accounts.find((a) => a.id === tdraft.to) : undefined;
  const tFrom = tdraft ? accounts.find((a) => a.id === tdraft.from) : undefined;

  const remove = async () => {
    if (!draft?.id) return;
    await removeAccount(db, draft.id);
    setDraft(null);
    await load();
  };

  return (
    <div className="fx-page">
      <PageHead title={t('accounts.title')} sub={t('accounts.subtitle')}>
        {accounts.length > 1 && <button type="button" className="fx-btn" onClick={() => openTransfer()}><Ic d={ICON.repeat} size={16} />{t('accounts.transfer')}</button>}
        <button type="button" className="fx-btn primary" onClick={openNew}><Ic d={ICON.plus} size={16} />{t('accounts.create')}</button>
      </PageHead>

      <div className="fx-kpis">
        <div className="fx-card fx-kpi">
          <div className="fx-kpi-label">{t('accounts.netWorth')}</div>
          <div className="fx-kpi-value"><span className={totals.net < 0 ? 'fx-neg' : ''}>{money(totals.net)}</span></div>
          <div className="fx-kpi-sub">{t('accounts.netWorthHint')}</div>
        </div>
        {(['spending', 'savings', 'debt'] as AccountType[]).map((ty) => (
          <div className="fx-card fx-kpi" key={ty}>
            <div className="fx-kpi-label">{t('accounts.type_' + ty)}</div>
            <div className="fx-kpi-row">
              <div className="fx-kpi-ic" style={{ background: TYPE_COLOR[ty] }}><Ic d={TYPE_ICON[ty]} size={22} /></div>
              <div>
                <div className="fx-kpi-value"><span>{money(totals[ty])}</span></div>
                <div className="fx-kpi-sub">{t('accounts.count', { count: accounts.filter((a) => a.type === ty).length })}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="fx-toolbar">
        <Seg<AccountType> value={tab} onChange={setTab} label={t('accounts.title')}
          options={[{ id: 'spending', label: t('accounts.type_spending') }, { id: 'savings', label: t('accounts.type_savings') }, { id: 'debt', label: t('accounts.type_debt') }]} />
      </div>

      {shown.length === 0 ? (
        <div className="fx-card">
          <EmptyState icon={TYPE_ICON[tab]} title={t('accounts.emptyTitle')} sub={t('accounts.emptySub')}
            action={<button type="button" className="fx-btn primary" onClick={openNew}><Ic d={ICON.plus} size={16} />{t('accounts.create')}</button>} />
        </div>
      ) : (
        <div className="fx-acc-grid">
          {shown.map((a) => (
            <div className="fx-card fx-acc" key={a.id}>
              <div className="fx-acc-top">
                <div className="fx-acc-ic" style={{ background: TYPE_COLOR[a.type] }}><Ic d={TYPE_ICON[a.type]} size={20} /></div>
                <div className="fx-acc-name">
                  <b>{a.name}</b>
                  <span>{a.description || a.currency}</span>
                </div>
                <button type="button" className="fx-round" onClick={() => openEdit(a)} aria-label={t('common.edit')}><Ic d={ICON.edit} size={16} /></button>
              </div>
              <div className={'fx-big' + (bal(a) < 0 ? ' fx-neg' : '')}>{money(bal(a), a.currency)}</div>
              <div className="fx-acc-tags">
                {a.isDefault && <span className="fx-tag">{t('accounts.default')}</span>}
                {a.includeInNetWorth && <span className="fx-tag">{t('accounts.inNetWorth')}</span>}
                {a.showOnHome && <span className="fx-tag">{t('accounts.onHome')}</span>}
              </div>
              {a.type === 'debt' && bal(a) > 0 && accounts.length > 1 && (
                <button type="button" className="fx-btn primary fx-abate" onClick={() => openTransfer(a)}><Ic d={ICON.debt} size={16} />{t('accounts.abate')}</button>
              )}
            </div>
          ))}
          <button type="button" className="fx-acc-add" onClick={openNew}><Ic d={ICON.plus} size={22} /><span>{t('accounts.create')}</span></button>
        </div>
      )}

      {transfers.length > 0 && (
        <div className="fx-card fx-transfers">
          <h3 className="fx-h3">{t('accounts.transfers')}</h3>
          {transfers.slice(0, 12).map((tr) => {
            const to = accounts.find((a) => a.id === tr.toAccountId);
            return (
              <div className="fx-tr-row" key={tr.id}>
                <span className="fx-tr-date">{tr.date}</span>
                <span className="fx-tr-names">{nameOf(tr.fromAccountId)} → {nameOf(tr.toAccountId)}{to?.type === 'debt' ? ' · ' + t('accounts.abateTag') : ''}{tr.note ? ' · ' + tr.note : ''}</span>
                <b>{money(tr.amountCents, to?.currency)}</b>
                <button type="button" className="fx-round" onClick={() => delTransfer(tr.id)} aria-label={t('common.delete')}><Ic d={ICON.trash} size={15} /></button>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={tdraft !== null} onClose={() => setTdraft(null)} title={tdraft?.abate ? t('accounts.abateTitle') : t('accounts.transferTitle')}
        footer={
          <>
            <span style={{ flex: 1 }} />
            <button type="button" className="fx-btn" onClick={() => setTdraft(null)}>{t('common.cancel')}</button>
            <button type="button" className="fx-btn primary" onClick={saveTransfer}>{tdraft?.abate ? t('accounts.abate') : t('accounts.transfer')}</button>
          </>
        }>
        {tdraft && (
          <>
            {terror && <p className="fx-error">{terror}</p>}
            {tdraft.abate && <p className="fx-hint">{t('accounts.abateHint')}</p>}
            <div className="fx-two">
              <Field label={t('accounts.from')}>
                <select className="fx-input" value={tdraft.from} onChange={(e) => setTdraft({ ...tdraft, from: e.target.value })}>
                  {accounts.filter((a) => !tdraft.abate || a.type !== 'debt').map((a) => <option key={a.id} value={a.id}>{a.name} · {money(bal(a), a.currency)}</option>)}
                </select>
              </Field>
              <Field label={t('accounts.to')}>
                <select className="fx-input" value={tdraft.to} disabled={tdraft.abate} onChange={(e) => setTdraft({ ...tdraft, to: e.target.value })}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {money(bal(a), a.currency)}</option>)}
                </select>
              </Field>
            </div>
            {tFrom && tTarget && tFrom.currency !== tTarget.currency && <p className="fx-error">{t('accounts.err_currency')}</p>}
            <div className="fx-two">
              <Field label={t('accounts.amount')}>
                <input className="fx-input big" autoFocus inputMode="decimal" value={tdraft.amount} placeholder="0,00" onChange={(e) => setTdraft({ ...tdraft, amount: e.target.value })} />
              </Field>
              <Field label={t('accounts.date')}>
                <input className="fx-input" type="date" value={tdraft.date} onChange={(e) => setTdraft({ ...tdraft, date: e.target.value })} />
              </Field>
            </div>
            <Field label={t('accounts.category')}>
              <select className="fx-input" value={tdraft.categoryId} onChange={(e) => setTdraft({ ...tdraft, categoryId: e.target.value })}>
                <option value="">{t('accounts.noCategory')}</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label={t('accounts.note')}>
              <input className="fx-input" value={tdraft.note} placeholder={t('accounts.notePlaceholder')} onChange={(e) => setTdraft({ ...tdraft, note: e.target.value })} />
            </Field>
            {tTarget?.type === 'debt' && <p className="fx-hint">{t('accounts.abateExpenseHint')}</p>}
          </>
        )}
      </Sheet>

      <Sheet open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? t('accounts.edit') : t('accounts.add_' + (draft?.type ?? 'spending'))}
        footer={
          <>
            {draft?.id && accounts.length > 1 && <button type="button" className="fx-btn danger" onClick={remove}><Ic d={ICON.trash} size={16} />{t('common.delete')}</button>}
            <span style={{ flex: 1 }} />
            <button type="button" className="fx-btn" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
            <button type="button" className="fx-btn primary" onClick={save}>{draft?.id ? t('common.save') : t('accounts.create')}</button>
          </>
        }>
        {draft && (
          <>
            {error && <p className="fx-error">{error}</p>}
            <Field label={t('accounts.name')}>
              <input className="fx-input big" autoFocus value={draft.name} placeholder={t('accounts.namePlaceholder')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={t('accounts.description')}>
              <input className="fx-input" value={draft.description} placeholder={t('accounts.descriptionPlaceholder')} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <div className="fx-two">
              <Field label={t('accounts.type')}>
                <select className="fx-input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as AccountType })}>
                  {(['spending', 'savings', 'debt'] as AccountType[]).map((ty) => <option key={ty} value={ty}>{t('accounts.type_' + ty)}</option>)}
                </select>
              </Field>
              <Field label={t('accounts.currency')}>
                <select className="fx-input" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label={t('accounts.initialBalance')}>
              <input className="fx-input big" inputMode="decimal" value={draft.initial} placeholder="0" onChange={(e) => setDraft({ ...draft, initial: e.target.value })} />
            </Field>
            <Toggle on={draft.includeInNetWorth} onChange={(v) => setDraft({ ...draft, includeInNetWorth: v })} label={t('accounts.includeNetWorth')} hint={t('accounts.includeNetWorthHint')} />
            <Toggle on={draft.isDefault} onChange={(v) => setDraft({ ...draft, isDefault: v })} label={t('accounts.defaultAccount')} hint={t('accounts.defaultAccountHint')} />
            <Toggle on={draft.showOnHome} onChange={(v) => setDraft({ ...draft, showOnHome: v })} label={t('accounts.showHome')} hint={t('accounts.showHomeHint')} />
          </>
        )}
      </Sheet>
    </div>
  );
}
