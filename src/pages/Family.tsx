import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { balances, householdSpent, MAX_MEMBERS, settleUp, type HouseholdExpense, type HouseholdMember } from '../core/family';
import { EmptyState, Field, Ic, ICON, PageHead, Sheet } from '../ui/fx';
import { Locked } from './Premium';

// Família: carteira da casa partilhada (online, no Supabase; ver supabase/family.sql).
// Não mistura com os dados pessoais: aqui só ficam as despesas da casa e quem deve a quem.

interface Household { id: string; name: string; owner_id: string; invite_code: string; currency: string }

const toExpense = (r: any): HouseholdExpense => ({
  id: r.id, paidBy: r.paid_by, description: r.description, amountCents: Number(r.amount_cents), date: r.date,
  splitAmong: r.split_among ?? [], isSettlement: !!r.is_settlement, deletedAt: r.deleted_at,
});

export function FamilyPage() {
  const { t } = useTranslation();
  return (
    <div className="fx-page">
      <PageHead title={t('family.title')} sub={t('family.sub')} />
      <Locked feature="shared"><FamilyInner /></Locked>
    </div>
  );
}

function FamilyInner() {
  const { t } = useTranslation();
  const auth = useAuth();
  const me = auth.user?.id ?? '';
  const settings = loadSettings();
  const [hh, setHh] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [expenses, setExpenses] = useState<HouseholdExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ description: '', amount: '', date: new Date().toISOString().slice(0, 10), paidBy: '', split: [] as string[] });
  const [setup, setSetup] = useState({ name: '', code: '', display: (auth.user?.email ?? '').split('@')[0] });

  const money = (c: number) => formatMoney(c, hh?.currency ?? settings.currency, settings.language);
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName ?? '?';
  const fail = (e: unknown) => {
    const msg = (e as { message?: string })?.message ?? String(e);
    const known = ['invalid code', 'household full', 'already in a household'].find((k) => msg.includes(k));
    setError(known ? t('family.err_' + known.replace(/ /g, '_')) : msg);
  };

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !me) { setLoading(false); return; }
    setError(null);
    const { data: mine, error: e1 } = await sb.from('household_members').select('household_id').eq('user_id', me).limit(1);
    if (e1) { fail(e1); setLoading(false); return; }
    const hid = mine?.[0]?.household_id;
    if (!hid) { setHh(null); setMembers([]); setExpenses([]); setLoading(false); return; }
    const [h, m, x] = await Promise.all([
      sb.from('households').select('*').eq('id', hid).single(),
      sb.from('household_members').select('user_id, display_name, joined_at').eq('household_id', hid).order('joined_at'),
      sb.from('household_expenses').select('*').eq('household_id', hid).is('deleted_at', null).order('date', { ascending: false }).limit(500),
    ]);
    const err = h.error || m.error || x.error;
    if (err) fail(err);
    setHh(h.data as Household);
    setMembers((m.data ?? []).map((r: any) => ({ userId: r.user_id, displayName: r.display_name })));
    setExpenses((x.data ?? []).map(toExpense));
    setLoading(false);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load().catch(fail); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const bal = useMemo(() => balances(members, expenses), [members, expenses]);
  const debts = useMemo(() => settleUp(bal), [bal]);
  const month = new Date().toISOString().slice(0, 7);

  if (!getSupabase() || !auth.user) {
    return <EmptyState icon={ICON.check} title={t('family.needLogin')} sub={t('family.needLoginSub')} action={<Link to="/definicoes" className="fx-btn primary">{t('family.goLogin')}</Link>} />;
  }
  if (loading) return <p className="fx-muted">…</p>;

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const sb = getSupabase();
    if (!sb) return;
    setError(null);
    const { error: e } = await sb.rpc(fn, args);
    if (e) { fail(e); return; }
    await load();
  };

  // ---- sem casa: criar ou entrar com código
  if (!hh) {
    return (
      <div className="fm-setup">
        {error && <p className="fx-error">{error}</p>}
        <Field label={t('family.yourName')}><input className="fx-input" value={setup.display} onChange={(e) => setSetup({ ...setup, display: e.target.value })} /></Field>
        <div className="fx-two">
          <div className="fx-card">
            <h3>{t('family.create')}</h3>
            <p className="fx-muted fx-small">{t('family.createSub')}</p>
            <Field label={t('family.houseName')}><input className="fx-input" value={setup.name} placeholder={t('family.houseNamePh')} onChange={(e) => setSetup({ ...setup, name: e.target.value })} /></Field>
            <button type="button" className="fx-btn primary" disabled={!setup.name.trim() || !setup.display.trim()}
              onClick={() => rpc('create_household', { p_name: setup.name, p_display_name: setup.display, p_currency: settings.currency })}>{t('family.create')}</button>
          </div>
          <div className="fx-card">
            <h3>{t('family.join')}</h3>
            <p className="fx-muted fx-small">{t('family.joinSub')}</p>
            <Field label={t('family.code')}><input className="fx-input" value={setup.code} placeholder="AB12CD34" onChange={(e) => setSetup({ ...setup, code: e.target.value.toUpperCase() })} /></Field>
            <button type="button" className="fx-btn primary" disabled={setup.code.trim().length < 6 || !setup.display.trim()}
              onClick={() => rpc('join_household', { p_code: setup.code, p_display_name: setup.display })}>{t('family.join')}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- com casa
  const openAdd = () => { setF({ description: '', amount: '', date: new Date().toISOString().slice(0, 10), paidBy: me, split: members.map((m) => m.userId) }); setOpen(true); };
  const insert = async (row: { description: string; amountCents: number; date: string; paidBy: string; split: string[]; settlement: boolean }) => {
    const sb = getSupabase();
    if (!sb) return;
    const { error: e } = await sb.from('household_expenses').insert({
      household_id: hh.id, paid_by: row.paidBy, description: row.description, amount_cents: row.amountCents,
      date: row.date, split_among: row.split, is_settlement: row.settlement,
    });
    if (e) fail(e); else await load();
  };
  const save = async () => {
    const cents = parseMoneyToCents(f.amount) ?? 0;
    if (!f.description.trim() || cents <= 0 || f.split.length === 0) return;
    await insert({ description: f.description.trim(), amountCents: cents, date: f.date, paidBy: f.paidBy, split: f.split, settlement: false });
    setOpen(false);
  };
  const settle = (d: { from: string; to: string; amountCents: number }) =>
    insert({ description: t('family.settlementDesc', { from: nameOf(d.from), to: nameOf(d.to) }), amountCents: d.amountCents, date: new Date().toISOString().slice(0, 10), paidBy: d.from, split: [d.to], settlement: true });
  const remove = async (id: string) => {
    const sb = getSupabase();
    if (!sb) return;
    const { error: e } = await sb.from('household_expenses').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (e) fail(e); else await load();
  };
  const leave = () => { if (window.confirm(t('family.leaveConfirm'))) rpc('leave_household', { p_household: hh.id }); };
  const toggleSplit = (id: string) => setF({ ...f, split: f.split.includes(id) ? f.split.filter((x) => x !== id) : [...f.split, id] });

  return (
    <>
      {error && <p className="fx-error">{error}</p>}
      <div className="fx-card fm-head">
        <div style={{ flex: 1 }}>
          <b className="fm-name">{hh.name}</b>
          <small className="fx-muted">{t('family.monthSpent', { amount: money(householdSpent(expenses, month)) })} · {t('family.members', { n: members.length, max: MAX_MEMBERS })}</small>
        </div>
        <button type="button" className="fx-btn primary" onClick={openAdd}><Ic d={ICON.plus} /> {t('family.add')}</button>
      </div>

      <div className="fx-two">
        <div className="fx-card">
          <h3>{t('family.whoOwes')}</h3>
          {debts.length === 0 ? <p className="fx-muted">{t('family.allSettled')}</p> : (
            <div className="pm-list">
              {debts.map((d) => (
                <div key={d.from + d.to} className="pm-sub">
                  <div className="pm-sub-main"><b>{t('family.owes', { from: nameOf(d.from), to: nameOf(d.to) })}</b></div>
                  <div className="pm-sub-right">
                    <span className="pm-chip">{money(d.amountCents)}</span>
                    {(d.from === me || d.to === me) && <button type="button" className="fx-link" onClick={() => settle(d)}>{t('family.settle')}</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="fx-card">
          <h3>{t('family.people')}</h3>
          <div className="pm-list">
            {members.map((m) => (
              <div key={m.userId} className="pm-sub">
                <div className="pm-sub-main"><b>{m.displayName}{m.userId === me ? ` (${t('family.you')})` : ''}</b></div>
                <span className={'pm-chip' + ((bal[m.userId] ?? 0) < 0 ? ' warn' : '')}>{money(bal[m.userId] ?? 0)}</span>
              </div>
            ))}
          </div>
          {members.length < MAX_MEMBERS && (
            <p className="fx-small">{t('family.invite')} <b className="fm-code">{hh.invite_code}</b>
              {hh.owner_id === me && <> · <button type="button" className="fx-link" onClick={() => rpc('new_invite_code', { p_household: hh.id })}>{t('family.newCode')}</button></>}
            </p>
          )}
          <button type="button" className="fx-link" onClick={leave}>{t('family.leave')}</button>
        </div>
      </div>

      <h2 className="pm-h2">{t('family.history')}</h2>
      {expenses.length === 0 ? <EmptyState icon={ICON.check} title={t('family.empty')} sub={t('family.emptySub')} /> : (
        <div className="pm-list">
          {expenses.map((e) => (
            <div key={e.id} className="fx-card pm-sub">
              <div className="pm-sub-main">
                <b>{e.description}</b>
                <small className="fx-muted">{e.date.split('-').reverse().join('/')} · {e.isSettlement ? t('family.settlement') : t('family.paidBy', { name: nameOf(e.paidBy), n: e.splitAmong.length })}</small>
              </div>
              <div className="pm-sub-right">
                <b>{money(e.amountCents)}</b>
                <button type="button" className="fx-link" onClick={() => remove(e.id)}>{t('common.delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('family.add')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={save}>{t('common.add')}</button></>}>
        <Field label={t('family.what')}><input className="fx-input" value={f.description} placeholder={t('family.whatPh')} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="fx-two">
          <Field label={t('family.amount')}><input className="fx-input" inputMode="decimal" value={f.amount} placeholder="0,00" onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label={t('family.date')}><input className="fx-input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label={t('family.whoPaid')}>
          <select className="fx-input" value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value })}>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
          </select>
        </Field>
        <Field label={t('family.splitWith')}>
          <div className="fm-split">
            {members.map((m) => (
              <label key={m.userId}><input type="checkbox" checked={f.split.includes(m.userId)} onChange={() => toggleSplit(m.userId)} /> {m.displayName}</label>
            ))}
          </div>
        </Field>
      </Sheet>
    </>
  );
}
