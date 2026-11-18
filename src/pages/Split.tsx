import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { db } from '../db/app-db';
import type { Category } from '../db/database';
import { activeCategories, addTransaction } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { hasFeature } from '../core/plan';
import { billStatus, myPending, parseContact, toBills, type SplitBill } from '../core/split';
import { catFitsKind, catLabel, EmptyState, Field, Ic, ICON, PageHead, Sheet } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { usePlan } from './Premium';

// Divisão de contas: grupos com convite por email/telemóvel (a pessoa aceita), contas divididas em partes iguais
// e quem já pagou / falta pagar. Criar grupos é do plano Família; quem é convidado participa em qualquer plano.

interface Group { id: string; name: string; owner_id: string; currency: string }
interface Member { userId: string; displayName: string }
interface Invite { id: string; group_id: string; group_name: string; invited_by_name: string }
interface PendingOut { id: string; email: string | null; phone: string | null }
type AddPersonal = { description: string; cents: number; date: string; categoryId: string };

const today = () => new Date().toLocaleDateString('sv-SE');
const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e);

export function SplitPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  usePlan(); // re-render quando o plano muda
  const me = auth.user?.id ?? '';
  const s = loadSettings();
  const [groups, setGroups] = useState<Group[]>([]);
  const [sel, setSel] = useState<string>('');
  const [members, setMembers] = useState<Member[]>([]);
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [outInv, setOutInv] = useState<PendingOut[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [myName, setMyName] = useState((auth.user?.email ?? '').split('@')[0]);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [contact, setContact] = useState('');
  const [bill, setBill] = useState<{ description: string; amount: string; date: string; members: string[]; iPaid: boolean } | null>(null);
  const [personal, setPersonal] = useState<AddPersonal | null>(null);

  const group = groups.find((g) => g.id === sel) ?? null;
  const money = (c: number) => formatMoney(c, group?.currency ?? s.currency, s.language);
  const nameOf = (id: string) => (id === me ? t('family.you') : members.find((m) => m.userId === id)?.displayName ?? '?');
  const labeled = useMemo(() => cats.filter((c) => catFitsKind(c, 'expense')).map((c) => ({ id: c.id, label: catLabel(t, c) })), [cats, t]);

  const loadList = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !me) return;
    const [g, inv] = await Promise.all([sb.from('split_groups').select('*').order('created_at'), sb.rpc('my_split_invites')]);
    if (g.error) setError(errText(g.error));
    setGroups((g.data ?? []) as Group[]);
    setInvites((inv.data ?? []) as Invite[]);
    setSel((cur) => (cur && (g.data ?? []).some((x: Group) => x.id === cur) ? cur : (g.data?.[0]?.id ?? '')));
  }, [me]);

  const loadGroup = useCallback(async (gid: string) => {
    const sb = getSupabase();
    if (!sb || !gid) { setMembers([]); setBills([]); setOutInv([]); return; }
    const [m, b, i] = await Promise.all([
      sb.from('split_members').select('user_id, display_name').eq('group_id', gid).order('joined_at'),
      sb.from('split_bills').select('*').eq('group_id', gid).is('deleted_at', null).order('date', { ascending: false }).limit(300),
      sb.from('split_invites').select('id, email, phone').eq('group_id', gid).eq('status', 'pending'),
    ]);
    const ids = (b.data ?? []).map((x: { id: string }) => x.id);
    const sh = ids.length ? await sb.from('split_shares').select('*').in('bill_id', ids) : { data: [], error: null };
    const err = m.error || b.error || i.error || sh.error;
    if (err) setError(errText(err));
    setMembers((m.data ?? []).map((r: any) => ({ userId: r.user_id, displayName: r.display_name })));
    setBills(toBills(b.data ?? [], sh.data ?? []));
    setOutInv((i.data ?? []) as PendingOut[]);
  }, []);

  useEffect(() => { loadList().catch((e) => setError(errText(e))); activeCategories(db).then(setCats).catch(() => {}); }, [loadList]);
  useEffect(() => { loadGroup(sel).catch((e) => setError(errText(e))); }, [sel, loadGroup]);

  if (!getSupabase() || !auth.user) {
    return (
      <div className="fx-page">
        <PageHead title={t('split.title')} sub={t('split.sub')} />
        <EmptyState icon={ICON.check} title={t('split.needLogin')} action={<Link to="/definicoes" className="fx-btn primary">{t('family.goLogin')}</Link>} />
      </div>
    );
  }

  const rpc = async (fn: string, args: Record<string, unknown>): Promise<boolean> => {
    setError(null); setInfo(null);
    const { error: e } = await getSupabase()!.rpc(fn, args);
    if (e) { setError(errText(e)); return false; }
    return true;
  };
  const otherCat = () => (labeled.find((c) => /restaur|aliment|food|casa|home|outr|other/i.test(c.label)) ?? labeled[0])?.id ?? '';
  const askPersonal = (description: string, cents: number, date: string) => setPersonal({ description, cents, date, categoryId: otherCat() });

  const createGroup = async () => {
    if (!newGroup?.trim() || !myName.trim()) return;
    if (await rpc('create_split_group', { p_name: newGroup, p_display_name: myName, p_currency: s.currency })) { setNewGroup(null); await loadList(); }
  };
  const answer = async (inv: Invite, accept: boolean) => {
    if (accept && !myName.trim()) return;
    if (await rpc('answer_split_invite', { p_invite: inv.id, p_accept: accept, p_display_name: myName })) { await loadList(); if (accept) setSel(inv.group_id); }
  };
  const invite = async () => {
    const c = parseContact(contact);
    if (!c) { setError(t('split.badContact')); return; }
    if (await rpc('invite_to_split', { p_group: sel, p_email: c.email, p_phone: c.phone })) { setContact(''); setInfo(t('split.invited')); await loadGroup(sel); }
  };
  const saveBill = async () => {
    if (!bill) return;
    const cents = parseMoneyToCents(bill.amount) ?? 0;
    if (!bill.description.trim() || cents <= 0 || bill.members.length === 0) return;
    setError(null);
    const sb = getSupabase()!;
    const { data: bid, error: e } = await sb.rpc('add_split_bill', { p_group: sel, p_description: bill.description, p_amount_cents: cents, p_date: bill.date, p_members: bill.members, p_creator_paid: bill.iPaid });
    if (e) { setError(errText(e)); return; }
    const mine = bill.members.includes(me);
    const { data: myRow } = mine ? await sb.from('split_shares').select('share_cents').eq('bill_id', bid).eq('user_id', me).maybeSingle() : { data: null };
    const myShare = Number(myRow?.share_cents ?? 0);
    const desc = bill.description.trim();
    const date = bill.date;
    const iPaid = bill.iPaid;
    setBill(null);
    await loadGroup(sel);
    if (iPaid && mine && myShare > 0) askPersonal(`${desc} (${group?.name ?? ''})`, myShare, date);
  };
  const setPaid = async (b: SplitBill, userId: string, paid: boolean) => {
    if (!(await rpc('set_split_paid', { p_bill: b.id, p_user: userId, p_paid: paid }))) return;
    await loadGroup(sel);
    const share = b.shares.find((x) => x.userId === userId);
    if (paid && userId === me && share) askPersonal(`${b.description} (${group?.name ?? ''})`, share.shareCents, today());
  };
  const removeBill = async (b: SplitBill) => {
    if (!window.confirm(t('split.deleteConfirm'))) return;
    const { error: e } = await getSupabase()!.from('split_bills').update({ deleted_at: new Date().toISOString() }).eq('id', b.id);
    if (e) setError(errText(e)); else await loadGroup(sel);
  };
  const leave = async () => {
    if (!window.confirm(t('split.leaveConfirm'))) return;
    if (await rpc('leave_split_group', { p_group: sel })) { setSel(''); await loadList(); }
  };
  const savePersonal = async () => {
    if (!personal?.categoryId) return;
    await addTransaction(db, { date: personal.date, type: 'expense', categoryId: personal.categoryId, description: personal.description, amountCents: personal.cents, currency: group?.currency ?? s.currency });
    setInfo(t('split.addedPersonal', { amount: money(personal.cents) }));
    setPersonal(null);
  };

  const canCreate = hasFeature('shared');
  const pend = myPending(bills, me);

  return (
    <div className="fx-page">
      <PageHead title={t('split.title')} sub={t('split.sub')}>
        {canCreate
          ? <button type="button" className="fx-btn primary" onClick={() => setNewGroup('')}><Ic d={ICON.plus} /> {t('split.newGroup')}</button>
          : <Link to="/plus" className="fx-btn">{t('split.createNeedsFamily')}</Link>}
      </PageHead>
      {error && <p className="fx-error">{error}</p>}
      {info && <p className="fx-muted">{info}</p>}

      {invites.length > 0 && (
        <div className="fx-card sp-invites">
          <h3>{t('split.invitesTitle')}</h3>
          <Field label={t('family.yourName')}><input className="fx-input" value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
          {invites.map((i) => (
            <div key={i.id} className="pm-sub">
              <div className="pm-sub-main"><b>{i.group_name}</b><small className="fx-muted">{t('split.invitedBy', { name: i.invited_by_name })}</small></div>
              <button type="button" className="fx-btn primary" onClick={() => answer(i, true)}>{t('split.accept')}</button>
              <button type="button" className="fx-btn" onClick={() => answer(i, false)}>{t('split.decline')}</button>
            </div>
          ))}
        </div>
      )}

      {groups.length === 0 ? <EmptyState icon={ICON.check} title={t('split.empty')} sub={t('split.emptySub')} /> : (
        <>
          <div className="sp-tabs">
            {groups.map((g) => <button key={g.id} type="button" className={'fx-btn' + (g.id === sel ? ' primary' : '')} onClick={() => setSel(g.id)}>{g.name}</button>)}
          </div>
          {group && (
            <>
              <div className="fx-card fm-head">
                <div style={{ flex: 1 }}>
                  <b className="fm-name">{group.name}</b>
                  <small className="fx-muted">{pend.count > 0 ? t('split.youOwe', { amount: money(pend.cents), count: pend.count }) : t('split.youOweNothing')}</small>
                </div>
                <button type="button" className="fx-btn primary" onClick={() => setBill({ description: '', amount: '', date: today(), members: members.map((m) => m.userId), iPaid: true })}><Ic d={ICON.plus} /> {t('split.newBill')}</button>
              </div>

              <div className="fx-two">
                <div>
                  <h2 className="pm-h2">{t('split.bills')}</h2>
                  {bills.length === 0 ? <p className="fx-muted">{t('split.noBills')}</p> : (
                    <div className="pm-list">
                      {bills.map((b) => {
                        const st = billStatus(b);
                        return (
                          <div key={b.id} className="fx-card sp-bill">
                            <div className="pm-sub">
                              <div className="pm-sub-main"><b>{b.description}</b><small className="fx-muted">{b.date.split('-').reverse().join('/')} · {t('split.perPerson', { amount: money(b.shares[0]?.shareCents ?? 0), n: b.shares.length })}</small></div>
                              <div className="pm-sub-right"><b>{money(b.amountCents)}</b><span className={'pm-chip' + (st.done ? '' : ' warn')}>{st.done ? t('split.allPaid') : t('split.missing', { amount: money(st.unpaidCents) })}</span></div>
                            </div>
                            <div className="sp-people">
                              {b.shares.map((x) => {
                                const can = x.userId === me || b.createdBy === me;
                                return (
                                  <button key={x.userId} type="button" disabled={!can} className={'sp-person' + (x.paidAt ? ' paid' : '')}
                                    title={can ? (x.paidAt ? t('split.markUnpaid') : t('split.markPaid')) : ''}
                                    onClick={() => setPaid(b, x.userId, !x.paidAt)}>
                                    {x.paidAt ? '✓' : '○'} {nameOf(x.userId)} · {money(x.shareCents)}
                                  </button>
                                );
                              })}
                            </div>
                            {b.createdBy === me && <button type="button" className="fx-link" onClick={() => removeBill(b)}>{t('common.delete')}</button>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="fx-card">
                  <h3>{t('family.people')}</h3>
                  <div className="pm-list">{members.map((m) => <div key={m.userId}>{m.displayName}{m.userId === me ? ` (${t('family.you')})` : ''}</div>)}</div>
                  {outInv.length > 0 && <p className="fx-muted fx-small">{t('split.waiting')}: {outInv.map((i) => i.email ?? '+' + i.phone).join(', ')}</p>}
                  <Field label={t('split.inviteLabel')}>
                    <div className="as-input">
                      <input className="fx-input" value={contact} placeholder={t('split.invitePh')} onChange={(e) => setContact(e.target.value)} />
                      <button type="button" className="fx-btn primary" disabled={!contact.trim()} onClick={invite}>{t('split.invite')}</button>
                    </div>
                  </Field>
                  <p className="fx-muted fx-small">{t('split.inviteHint')}</p>
                  <button type="button" className="fx-link" onClick={leave}>{t('split.leave')}</button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <Sheet open={newGroup !== null} onClose={() => setNewGroup(null)} title={t('split.newGroup')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setNewGroup(null)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={createGroup}>{t('common.add')}</button></>}>
        <Field label={t('split.groupName')}><input className="fx-input" value={newGroup ?? ''} placeholder={t('split.groupNamePh')} onChange={(e) => setNewGroup(e.target.value)} /></Field>
        <Field label={t('family.yourName')}><input className="fx-input" value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
      </Sheet>

      <Sheet open={!!bill} onClose={() => setBill(null)} title={t('split.newBill')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setBill(null)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={saveBill}>{t('common.add')}</button></>}>
        {bill && <>
          <Field label={t('family.what')}><input className="fx-input" value={bill.description} placeholder={t('split.billPh')} onChange={(e) => setBill({ ...bill, description: e.target.value })} /></Field>
          <div className="fx-two">
            <Field label={t('split.total')}><input className="fx-input" inputMode="decimal" value={bill.amount} placeholder="0,00" onChange={(e) => setBill({ ...bill, amount: e.target.value })} /></Field>
            <Field label={t('family.date')}><DatePicker value={bill.date} onChange={(v) => setBill({ ...bill, date: v })} /></Field>
          </div>
          <Field label={t('family.splitWith')}>
            <div className="fm-split">
              {members.map((m) => (
                <label key={m.userId}><input type="checkbox" checked={bill.members.includes(m.userId)}
                  onChange={() => setBill({ ...bill, members: bill.members.includes(m.userId) ? bill.members.filter((x) => x !== m.userId) : [...bill.members, m.userId] })} /> {m.displayName}</label>
              ))}
            </div>
          </Field>
          {(() => { const c = parseMoneyToCents(bill.amount) ?? 0; return c > 0 && bill.members.length > 0 ? <p className="fx-muted">{t('split.eachPays', { amount: money(Math.ceil(c / bill.members.length)) })}</p> : null; })()}
          <label className="fm-split"><input type="checkbox" checked={bill.iPaid} onChange={(e) => setBill({ ...bill, iPaid: e.target.checked })} /> {t('split.iPaidMine')}</label>
        </>}
      </Sheet>

      <Sheet open={!!personal} onClose={() => setPersonal(null)} title={t('split.personalTitle')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setPersonal(null)}>{t('split.personalNo')}</button><button type="button" className="fx-btn primary" onClick={savePersonal}>{t('split.personalYes')}</button></>}>
        {personal && <>
          <p>{t('split.personalText', { amount: money(personal.cents) })}</p>
          <Field label={t('family.what')}><input className="fx-input" value={personal.description} onChange={(e) => setPersonal({ ...personal, description: e.target.value })} /></Field>
          <div className="fx-two">
            <Field label={t('family.date')}><DatePicker value={personal.date} onChange={(v) => setPersonal({ ...personal, date: v })} /></Field>
            <Field label={t('assistant.category')}>
              <select className="fx-input" value={personal.categoryId} onChange={(e) => setPersonal({ ...personal, categoryId: e.target.value })}>
                {labeled.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          </div>
        </>}
      </Sheet>
    </div>
  );
}
