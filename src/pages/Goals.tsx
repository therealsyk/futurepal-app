import { L } from '../i18n/phrases';
import { FormError, useMissing } from '../ui/missing';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Category, Goal, Recurring, Group, Transaction, Transfer } from '../db/database';
import { newId } from '../db/database';
import { softDelete, addGoal, contributeToGoal, listGoals, estimateGoalCompletion, addRecurring, expandRecurring, RECURRING_FREQUENCIES, addGroup, listGroups, transactionsInGroup } from '../core/finance';
import { accountBalanceCents, salariesUntil, loadTransfers } from '../core/accounts';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageHead, Sheet, Field, Toggle, EmptyState, Ic, ICON, useAccounts, CategorySelect } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { todayISO } from '../core/dates';
import { FREE_LIMITS, withinFreeLimit } from '../core/plan';

function Ring({ pct, size = 92 }: { pct: number; size?: number }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth="9" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(Math.min(pct, 100) / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dy="0.35em" textAnchor="middle" fill="var(--text)" fontSize={size / 5} fontWeight="650">{Math.round(pct)}%</text>
    </svg>
  );
}

export function Goals() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const { accounts } = useAccounts();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [salaryCents, setSalaryCents] = useState(0);
  const [recurrings, setRecurrings] = useState<Recurring[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupTotals, setGroupTotals] = useState<Record<string, number>>({});
  const [cats, setCats] = useState<Category[]>([]);
  const [estimates, setEstimates] = useState<Record<string, { months: number | null; date: string | null }>>({});
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [gName, setGName] = useState('');
  const [gTarget, setGTarget] = useState('');
  const [gNotes, setGNotes] = useState('');
  const [gStart, setGStart] = useState(todayISO());
  const [gEnd, setGEnd] = useState('');
  const [gAccs, setGAccs] = useState<string[]>([]);
  const [contrib, setContrib] = useState<Record<string, string>>({});

  const [rDesc, setRDesc] = useState('');
  const [rAmount, setRAmount] = useState('');
  const [rCat, setRCat] = useState('');
  const [rFreq, setRFreq] = useState<Recurring['frequency']>('monthly');
  const [rNext, setRNext] = useState(todayISO());
  const [grpName, setGrpName] = useState('');

  const money = (c: number) => formatMoney(c, settings.currency, settings.language);

  // Apagar (meta, recorrência ou grupo) pede confirmação; é um soft delete, por isso também sincroniza.
  const [toDelete, setToDelete] = useState<{ table: 'goals' | 'recurrings' | 'groups'; id: string; name: string } | null>(null);
  const confirmDelete = async () => {
    if (!toDelete) return;
    await softDelete(db, toDelete.table, toDelete.id);
    setToDelete(null);
    await refresh();
  };

  const refresh = async () => {
    const gs = await listGoals(db);
    setGoals(gs);
    const est: Record<string, { months: number | null; date: string | null }> = {};
    for (const g of gs) est[g.id] = await estimateGoalCompletion(db, g);
    setEstimates(est);
    setRecurrings(await db.recurrings.filter((r) => r.deletedAt === null).toArray());
    const gs2 = await listGroups(db);
    setGroups(gs2);
    const totals: Record<string, number> = {};
    for (const g of gs2) totals[g.id] = (await transactionsInGroup(db, g.id)).reduce((a, b) => a + b.amountCents, 0);
    setGroupTotals(totals);
    const cs = await db.categories.filter((c) => c.deletedAt === null).toArray();
    setCats(cs);
    setRCat((cur) => cur || cs[0]?.id || '');
    setTxs((await db.transactions.toArray()).filter((x) => x.deletedAt === null));
    setTransfers(await loadTransfers(db));
    const now = new Date();
    setSalaryCents(salariesUntil(await db.salaries.toArray(), now.getFullYear(), now.getMonth() + 1));
  };
  useEffect(() => { refresh().catch((e) => setError(String(e))); }, []);

  const selectedValue = (ids: string[]) => accounts.filter((a) => ids.includes(a.id)).reduce((s, a) => s + accountBalanceCents(a, txs, accounts, salaryCents, transfers), 0);
  const currentOf = (g: Goal) => (g.accountIds && g.accountIds.length ? selectedValue(g.accountIds) : g.currentCents);

  const missing = useMissing();
  const miss = missing([['name', L('o nome'), !!gName.trim()], ['amount', L('o valor'), (parseMoneyToCents(gTarget) ?? 0) > 0]]);
  const closeNew = () => { setOpen(false); miss.reset(); };
  const createGoal = async () => {
    const cents = parseMoneyToCents(gTarget);
    setError(null);
    if (!miss.check() || cents === null) return;
    if (!withinFreeLimit('goals', goals.length)) { setError(t('plus.limitGoals', { n: FREE_LIMITS.goals })); return; }
    const g = await addGoal(db, gName.trim(), cents, gStart, gEnd || null);
    await db.goals.update(g.id, { notes: gNotes.trim() || undefined, accountIds: gAccs.length ? gAccs : undefined });
    setError(null); setOpen(false); setGName(''); setGTarget(''); setGNotes(''); setGEnd(''); setGAccs([]);
    await refresh();
  };

  const contribute = async (id: string) => {
    const cents = parseMoneyToCents(contrib[id] || '');
    if (cents === null || cents <= 0) return;
    await contributeToGoal(db, id, cents);
    setContrib((c) => ({ ...c, [id]: '' }));
    await refresh();
  };

  const createRecurring = async () => {
    const cents = parseMoneyToCents(rAmount);
    if (!rDesc.trim() || cents === null || cents <= 0 || !rCat) { setError(t('goals.invalid')); return; }
    await addRecurring(db, { type: 'expense', categoryId: rCat, description: rDesc.trim(), amountCents: cents, currency: settings.currency, frequency: rFreq, nextDate: rNext, endDate: null });
    setError(null); setRDesc(''); setRAmount('');
    await refresh();
  };

  const expandNow = async () => {
    const pending = await expandRecurring(db, todayISO());
    for (const tx of pending) await db.transactions.add({ ...tx, id: newId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null });
    await refresh();
  };

  const createGroup = async () => {
    if (!grpName.trim()) return;
    await addGroup(db, grpName.trim(), '#60A5FA');
    setGrpName('');
    await refresh();
  };

  return (
    <div className="fx-page">
      <PageHead title={t('goals.title')} sub={t('goals.subtitle')}>
        <button type="button" className="fx-btn primary" onClick={() => { setError(null); setOpen(true); }}><Ic d={ICON.plus} size={16} />{t('goals.createGoal')}</button>
      </PageHead>
      {error && !open && <p className="fx-error">{error}</p>}

      {goals.length === 0 ? (
        <div className="fx-card">
          <EmptyState icon={ICON.target} title={t('goals.setGoal')} sub={t('goals.setGoalSub')}
            action={<button type="button" className="fx-btn primary" onClick={() => setOpen(true)}><Ic d={ICON.plus} size={16} />{t('goals.createGoal')}</button>} />
        </div>
      ) : (
        <div className="fx-goal-grid">
          {goals.map((g) => {
            const cur = currentOf(g);
            const pct = g.targetCents > 0 ? (cur / g.targetCents) * 100 : 0;
            const est = estimates[g.id];
            const linked = !!(g.accountIds && g.accountIds.length);
            return (
              <div className="fx-card fx-goal" key={g.id}>
                <div className="fx-goal-top">
                  <Ring pct={Math.max(0, pct)} />
                  <div className="fx-goal-info">
                    <b>{g.name}</b>
                    <span>{money(cur)} <em>/ {money(g.targetCents)}</em></span>
                    <small>{g.targetDate ? `${t('goals.deadline')}: ${g.targetDate}` : t('goals.noDeadline')}</small>
                  </div>
                  <button type="button" className="fx-round sm fx-goal-del" onClick={() => setToDelete({ table: 'goals', id: g.id, name: g.name })} aria-label={t('goals.deleteGoal', { name: g.name })} data-testid="goal-delete"><Ic d={ICON.trash} size={15} /></button>
                </div>
                {est && <p className="fx-muted fx-small">{est.months === null ? t('goals.estimateNone') : `${t('goals.estimateLabel')} ${est.months} · ${t('goals.estimateDate')}: ${est.date}`}</p>}
                {g.notes && <p className="fx-muted fx-small">{g.notes}</p>}
                {linked ? <p className="fx-small fx-muted">{t('goals.linkedTo', { count: g.accountIds!.length })}</p> : (
                  <div className="fx-inline">
                    <input className="fx-input" inputMode="decimal" placeholder={t('goals.amount')} value={contrib[g.id] ?? ''} onChange={(e) => setContrib({ ...contrib, [g.id]: e.target.value })} aria-label={t('goals.amount')} />
                    <button type="button" className="fx-btn" onClick={() => contribute(g.id)}>{t('goals.contribute')}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="fx-row2" style={{ marginTop: 16 }}>
        <div className="fx-card">
          <div className="fx-card-head"><h2>{t('goals.recurringTitle')}</h2><button type="button" className="fx-btn" onClick={expandNow}><Ic d={ICON.repeat} size={15} />{t('goals.applyRecurring')}</button></div>
          <div className="fx-form-grid">
            <input className="fx-input" placeholder={t('transactions.description')} value={rDesc} onChange={(e) => setRDesc(e.target.value)} aria-label={t('transactions.description')} />
            <input className="fx-input" inputMode="decimal" placeholder={t('goals.amount')} value={rAmount} onChange={(e) => setRAmount(e.target.value)} aria-label={t('goals.amount')} />
            <CategorySelect cats={cats} kind="expense" value={rCat} onChange={setRCat} ariaLabel={t('transactions.category')} />
            <select className="fx-input" value={rFreq} onChange={(e) => setRFreq(e.target.value as Recurring['frequency'])} aria-label={t('goals.frequency')}>
              {RECURRING_FREQUENCIES.map((f) => <option key={f} value={f}>{t('goals.' + f)}</option>)}
            </select>
            <DatePicker value={rNext} onChange={(v) => setRNext(v)} ariaLabel={t('goals.nextDate')} />
            <button type="button" className="fx-btn primary" onClick={createRecurring}><Ic d={ICON.plus} size={15} />{t('goals.addRecurring')}</button>
          </div>
          {recurrings.length === 0 ? <p className="fx-empty">{t('goals.noRecurring')}</p> : (
            <div className="fx-list" style={{ marginTop: 10 }}>
              {recurrings.map((r) => (
                <div className="fx-item" key={r.id}>
                  <div className="fx-avatar"><Ic d={ICON.repeat} size={16} /></div>
                  <div className="fx-item-main"><b>{r.description}</b><span>{t('goals.' + r.frequency)} · {t('goals.nextDate')}: {r.nextDate}</span></div>
                  <span className="fx-num">{money(r.amountCents)}</span>
                  <button type="button" className="fx-round sm" onClick={() => setToDelete({ table: 'recurrings', id: r.id, name: r.description })} aria-label={t('goals.deleteItem', { name: r.description })}><Ic d={ICON.trash} size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fx-card">
          <div className="fx-card-head"><h2>{t('goals.groupsTitle')}</h2></div>
          <p className="fx-muted fx-small" style={{ marginTop: -6 }}>{t('goals.groupsHint')}</p>
          <div className="fx-inline">
            <input className="fx-input" placeholder={t('goals.groupName')} value={grpName} onChange={(e) => setGrpName(e.target.value)} aria-label={t('goals.groupName')} />
            <button type="button" className="fx-btn primary" onClick={createGroup}><Ic d={ICON.plus} size={15} />{t('goals.addGroup')}</button>
          </div>
          {groups.length === 0 ? <p className="fx-empty">{t('goals.noGroups')}</p> : (
            <div className="fx-list" style={{ marginTop: 10 }}>
              {groups.map((g) => (
                <div className="fx-item" key={g.id}>
                  <div className="fx-avatar" style={{ background: g.color, color: '#fff' }}><Ic d={ICON.folder} size={16} /></div>
                  <div className="fx-item-main"><b>{g.name}</b></div>
                  <span className="fx-num">{money(groupTotals[g.id] ?? 0)}</span>
                  <button type="button" className="fx-round sm" onClick={() => setToDelete({ table: 'groups', id: g.id, name: g.name })} aria-label={t('goals.deleteItem', { name: g.name })}><Ic d={ICON.trash} size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Sheet open={toDelete !== null} onClose={() => setToDelete(null)} title={t('goals.confirmTitle')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setToDelete(null)}>{t('common.cancel')}</button><button type="button" className="fx-btn danger" onClick={confirmDelete} data-testid="confirm-delete"><Ic d={ICON.trash} size={16} />{t('common.delete')}</button></>}>
        <p>{t('goals.confirmText', { name: toDelete?.name ?? '' })}</p>
        {toDelete?.table === 'groups' && <p className="fx-muted fx-small">{t('goals.confirmGroupNote')}</p>}
        {toDelete?.table === 'recurrings' && <p className="fx-muted fx-small">{t('goals.confirmRecurringNote')}</p>}
      </Sheet>

      <Sheet open={open} onClose={closeNew} title={t('goals.createGoal')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={closeNew}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={createGoal}>{t('goals.createGoal')}</button></>}>
        {miss.note ?? (error && <FormError text={error} />)}
        <Field label={t('goals.name')} miss={miss.cls('name')}><input className="fx-input" autoFocus value={gName} placeholder={t('goals.namePlaceholder')} onChange={(e) => setGName(e.target.value)} /></Field>
        <Field label={`${t('goals.target')} (${settings.currency})`} miss={miss.cls('amount')}><input className="fx-input big" inputMode="decimal" value={gTarget} placeholder="0" onChange={(e) => setGTarget(e.target.value)} /></Field>
        <div className="fx-two">
          <Field label={t('goals.startDate')}><DatePicker value={gStart} onChange={(v) => setGStart(v)} /></Field>
          <Field label={t('goals.targetDate')}><DatePicker value={gEnd} onChange={(v) => setGEnd(v)} allowEmpty /></Field>
        </div>
        <Field label={t('goals.notes')}><textarea className="fx-input" rows={2} value={gNotes} placeholder={t('goals.notesPlaceholder')} onChange={(e) => setGNotes(e.target.value)} /></Field>
        <div className="fx-label" style={{ margin: '14px 0 2px' }}>{t('goals.yourAccounts')}</div>
        {accounts.filter((a) => a.type !== 'debt').map((a) => (
          <Toggle key={a.id} on={gAccs.includes(a.id)} onChange={(v) => setGAccs(v ? [...gAccs, a.id] : gAccs.filter((x) => x !== a.id))} label={a.name} hint={`${t('accounts.type_' + a.type)} · ${money(accountBalanceCents(a, txs, accounts, salaryCents, transfers))}`} />
        ))}
        <div className="fx-stat" style={{ marginTop: 6 }}><span>{t('goals.selectedValue')}</span><span className="fx-num fx-pos">{money(selectedValue(gAccs))}</span></div>
      </Sheet>
    </div>
  );
}
