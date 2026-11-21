import { createPortal } from 'react-dom';
import { appConfirm } from '../ui/confirm';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { db } from '../db/app-db';
import type { Account, Category } from '../db/database';
import { activeCategories, addTransaction } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';

import { billProgress, groupSummary, parseContact, toBills, type SplitBill } from '../core/split';
import { avatarUrl } from '../core/avatar';
import { LockedPreview } from '../ui/LockedPreview';
import { catFitsKind, catLabel, CategorySelect, EmptyState, Ic, ICON, PageHead, Sheet } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { usePlan } from './Premium';
import { L } from '../i18n/phrases';
import { accountBalanceCents, defaultAccountId } from '../core/accounts';

// Divisão de contas: grupos com convite por email/telemóvel (a pessoa aceita), contas divididas em partes iguais
// e quem já pagou / falta pagar. Criar grupos é do plano Família; quem é convidado participa em qualquer plano.

interface Group { id: string; name: string; owner_id: string; currency: string }
interface Member { userId: string; displayName: string; avatarUrl: string | null }
interface Invite { id: string; group_id: string; group_name: string; invited_by_name: string }
interface PendingOut { id: string; email: string | null; phone: string | null; status?: string }
type AddPersonal = { description: string; cents: number; date: string; categoryId: string; accountId?: string };

const today = () => new Date().toLocaleDateString('sv-SE');
const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e);

export function SplitPage() {
  const { has } = usePlan();
  const canSplit = has('split');
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
  const [allInv, setAllInv] = useState<PendingOut[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const meta = (auth.user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  const myName = meta.full_name || meta.name || (auth.user?.email ?? '').split('@')[0] || '—'; // nome da conta, automático
  const [bill, setBill] = useState<{ description: string; amount: string; date: string; out: string[]; iPaid: boolean; categoryId: string; addMine: boolean; withGroup: string; invites: string } | null>(null);
  const [personal, setPersonal] = useState<AddPersonal | null>(null);
  const [accs, setAccs] = useState<Account[]>([]);
  const [bals, setBals] = useState<Record<string, number>>({});
  useEffect(() => {
    (async () => {
      const live = <T extends { deletedAt: string | null }>(r: T[]) => r.filter((x) => x.deletedAt === null);
      const all = live(await db.accounts.toArray()), txs = live(await db.transactions.toArray()), trs = live(await db.transfers.toArray()), sals = live(await db.salaries.toArray());
      const n = new Date(); const sal = sals.filter((x) => x.year * 100 + x.month <= n.getFullYear() * 100 + n.getMonth() + 1).reduce((a2, x) => a2 + x.amountCents, 0);
      setAccs(all.filter((a2) => a2.type !== 'debt'));
      setBals(Object.fromEntries(all.map((a2) => [a2.id, accountBalanceCents(a2, txs, all, sal, trs)])));
    })().catch(() => {});
  }, []);

  const group = groups.find((g) => g.id === sel) ?? null;
  const money = (c: number) => formatMoney(c, group?.currency ?? s.currency, s.language);
  const nameOf = (id: string) => (id === me ? t('family.you') : members.find((m) => m.userId === id)?.displayName ?? '?');
  const expCats = useMemo(() => cats.filter((c) => catFitsKind(c, 'expense')), [cats]);
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
      sb.from('split_members').select('*').eq('group_id', gid).order('joined_at'),
      sb.from('split_bills').select('*').eq('group_id', gid).is('deleted_at', null).order('date', { ascending: false }).limit(300),
      sb.from('split_invites').select('id, email, phone, status').eq('group_id', gid).in('status', ['pending', 'declined']),
    ]);
    const ids = (b.data ?? []).map((x: { id: string }) => x.id);
    const sh = ids.length ? await sb.from('split_shares').select('*').in('bill_id', ids) : { data: [], error: null };
    const err = m.error || b.error || i.error || sh.error;
    if (err) setError(errText(err));
    setMembers((m.data ?? []).map((r: any) => ({ userId: r.user_id, displayName: r.display_name, avatarUrl: r.avatar_url ?? null })));
    setBills(toBills(b.data ?? [], sh.data ?? []));
    const invs = (i.data ?? []) as PendingOut[];
    setAllInv(invs); setOutInv(invs.filter((x) => x.status !== 'declined'));
  }, []);

  useEffect(() => { loadList().catch((e) => setError(errText(e))); activeCategories(db).then(setCats).catch(() => {}); }, [loadList]);
  // Partilha a minha foto com os grupos (RPC idempotente; se a migração ainda não correu, ignora em silêncio).
  const myAvatar = avatarUrl(auth.user);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !me) return;
    Promise.resolve(sb.rpc('set_split_avatar', { p_url: myAvatar })).catch(() => {});
  }, [me, myAvatar]);
  useEffect(() => { loadGroup(sel).catch((e) => setError(errText(e))); }, [sel, loadGroup]);

  if (!getSupabase() || !auth.user) {
    return (
      <div className="fx-page">
        <PageHead title={t('split.title')} sub={t('split.sub')} />
        <LockedPreview kind="split" title={t('split.needLogin')} text={L('Cria grupos, divide as despesas em partes iguais e vê logo quem deve a quem.')} action={<Link to="/definicoes" className="fx-btn primary">{t('family.goLogin')}</Link>} />
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

  const openBill = () => setBill({ description: '', amount: '', date: today(), out: [], iPaid: true, categoryId: otherCat(), addMine: true, withGroup: sel, invites: '' });
  const contactsOf = (raw: string) => raw.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const [invDraft, setInvDraft] = useState('');
  // Convites como "chips": Enter, vírgula ou sair do campo confirma; só aceita email/telemóvel válido.
  const commitInvite = () => {
    const v = invDraft.trim().replace(/,$/, '');
    if (!bill || !v || !parseContact(v)) return;
    const list = contactsOf(bill.invites);
    if (!list.includes(v)) setBill({ ...bill, invites: [...list, v].join('\n') });
    setInvDraft('');
  };
  const answer = async (inv: Invite, accept: boolean) => {
    if (accept && !myName.trim()) return;
    if (await rpc('answer_split_invite', { p_invite: inv.id, p_accept: accept, p_display_name: myName })) { await loadList(); if (accept) setSel(inv.group_id); }
  };
  
  const saveBill = async () => {
    if (!bill) return;
    const cents = parseMoneyToCents(bill.amount) ?? 0;
    const contacts = contactsOf(bill.invites);
    const isNew = !bill.withGroup;
    let ids = members.map((m) => m.userId).filter((id) => !bill.out.includes(id));
    if (!bill.description.trim() || cents <= 0) return;
    if (isNew ? contacts.length === 0 || !myName.trim() : ids.length === 0) return;
    setError(null); setInfo(null);
    const sb = getSupabase()!;
    let gid = bill.withGroup;
    let people = ids.length;
    if (isNew) {
      const parsed = contacts.map((raw) => ({ raw, c: parseContact(raw) }));
      const bad = parsed.filter((p) => !p.c).map((p) => p.raw);
      if (bad.length) { setError(t('split.badContact') + ' ' + bad.join(', ')); return; }
      const name = [myName.trim(), ...contacts.map((c) => c.split('@')[0])].join(' + ');
      const g = await sb.rpc('create_split_group', { p_name: name, p_display_name: myName, p_currency: s.currency });
      if (g.error) { setError(errText(g.error)); return; }
      gid = String(g.data);
      for (const p of parsed) {
        const r = await sb.rpc('invite_to_split', { p_group: gid, p_email: p.c!.email, p_phone: p.c!.phone });
        if (r.error) { setError(errText(r.error)); return; }
      }
      ids = [me];
      people = 1 + contacts.length;
    }
    const { error: e } = await sb.rpc('add_split_bill', { p_group: gid, p_description: bill.description, p_amount_cents: cents, p_date: bill.date, p_members: ids, p_creator_paid: bill.iPaid });
    if (e) { setError(errText(e)); return; }
    const mine = ids.includes(me);
    const myShare = mine ? Math.ceil(cents / people) : 0;
    const { description, date, iPaid, addMine, categoryId } = bill;
    setBill(null);
    if (isNew) await loadList();
    if (gid === sel) await loadGroup(gid); else setSel(gid);
    if (iPaid && mine && myShare > 0 && addMine && categoryId) {
      await addTransaction(db, { date, type: 'expense', categoryId, description: description.trim(), amountCents: myShare, currency: group?.currency ?? s.currency });
      setInfo(t('split.addedPersonal', { amount: money(myShare) }));
    }
  };
  const setPaid = async (b: SplitBill, userId: string, paid: boolean) => {
    if (!(await rpc('set_split_paid', { p_bill: b.id, p_user: userId, p_paid: paid }))) return;
    await loadGroup(sel);
    const share = b.shares.find((x) => x.userId === userId);
    if (paid && userId === me && share) askPersonal(b.description, outInv.length ? Math.round(b.amountCents / (b.shares.length + outInv.length)) : share.shareCents, today());
  };
  const [closing, setClosing] = useState<SplitBill | null>(null);
  const removeBill = async (b: SplitBill) => {
    const { error: e } = await getSupabase()!.from('split_bills').update({ deleted_at: new Date().toISOString() }).eq('id', b.id);
    if (e) setError(errText(e)); else await loadGroup(sel);
  };
  const leave = async () => {
    if (!await appConfirm(t('split.leaveConfirm'))) return;
    if (await rpc('leave_split_group', { p_group: sel })) { setSel(''); await loadList(); }
  };
  const savePersonal = async () => {
    if (!personal?.categoryId) return;
    await addTransaction(db, { date: personal.date, type: 'expense', categoryId: personal.categoryId, description: personal.description, amountCents: personal.cents, currency: group?.currency ?? s.currency, accountId: personal.accountId || defaultAccountId(accs) || undefined });
    setInfo(t('split.addedPersonal', { amount: money(personal.cents) }));
    setPersonal(null);
  };

  const canCreate = canSplit; // criar grupos: Plus ou Pro (aceitar convites: qualquer plano)
  const sum = groupSummary(bills, me);

  return (
    <div className="fx-page sh">
      <PageHead title={t('split.title')} sub={t('split.sub')}>{!canCreate && <Link to="/plus" className="fx-btn">{t('split.createNeedsFamily')}</Link>}</PageHead>
      {(canCreate || groups.length > 0) && <button type="button" className="sh-pill" onClick={openBill}><Ic d={ICON.plus} size={16} />{t('split.newBill')}</button>}
      {error && <p className="fx-error">{error}</p>}
      {info && <p className="fx-muted">{info}</p>}

      {invites.length > 0 && (
        <div className="fx-card sp-invites">
          <h3>{t('split.invitesTitle')}</h3>
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
            {groups.length > 1
              ? <select className="fx-input sp-group-select" value={sel} onChange={(e) => setSel(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
              : null}
          </div>
          {group && (
            <>

              {(sum.iOweCents > 0 || sum.owedToMeCents > 0) && <div className={'sp-hero ' + (sum.iOweCents > 0 ? 'owe' : 'owed')}>
                {sum.iOweCents > 0 ? <><small>{L('Tens de pagar')}</small><b>{money(sum.iOweCents)}</b></>
                  : sum.owedToMeCents > 0 ? <><small>{L('Têm de te pagar')}</small><b>{money(sum.owedToMeCents)}</b></>
                  : null}
              </div>}

              <div className="sp-main">
                <div>
                  <div className="sp-head">
                    
                    
                  </div>
                  {bills.length === 0 ? <div className="fx-card"><p className="fx-muted">{t('split.noBills')}</p></div> : (
                    <div className="pm-list">
                      {bills.map((b) => {
                        const pr = billProgress(b);
                        const mine = b.shares.find((x) => x.userId === me);
                        // convites ainda pendentes já contam para a divisão (o servidor recalcula as partes quando aceitam)
                        const pendN = outInv.length;
                        const each = pendN ? Math.round(pr.totalCents / (b.shares.length + pendN)) : null;
                        // quanto falta pagar: conta também com a parte de quem ainda não aceitou
                        const left = each === null ? pr.remainingCents : Math.max(0, pr.totalCents - b.shares.filter((x) => x.paidAt).length * each);
                        return (
                          <div key={b.id} className={'fx-card sp-bill' + (pr.done ? ' done' : '')}>
                            {/* título e total numa caixa própria; data e valor por pessoa em etiquetas por baixo */}
                            {b.createdBy === me && <button type="button" className="sp-x" onClick={() => setClosing(b)} aria-label={L('Fechar conta')} title={L('Fechar conta')}>✕</button>}
                            <div className="sp-bill-head">
                              <span className="sp-bill-tt"><b className="sp-bill-title">{b.description}</b><small className="sp-bill-sub">{b.date.split('-').reverse().join('/')} · {money(each ?? pr.eachCents)} {L('por pessoa')}</small></span>
                              <span className="sp-bill-total">
                                <small>{t('split.total')}</small><b>{money(pr.totalCents)}</b>
                                <span className={'sp-tag ' + (left > 0 ? 'warn' : 'ok')}>{left > 0 ? t('split.missing', { amount: money(left) }) : t('split.allPaid')}</span>
                              </span>
                            </div>
                            {/* Pessoas: foto e nome, estado do convite à frente; por baixo quanto paga e se já pagou */}
                            <div className="sp-list">
                              {b.shares.map((x) => {
                                const can = b.createdBy === me && x.userId !== me;
                                const m = members.find((mm) => mm.userId === x.userId) ?? { userId: x.userId, displayName: nameOf(x.userId), avatarUrl: null };
                                const Row = can ? 'button' : 'div';
                                return (
                                  <Row key={x.userId} {...(can ? { type: 'button' as const, onClick: () => setPaid(b, x.userId, !x.paidAt), title: x.paidAt ? t('split.markUnpaid') : t('split.markPaid') } : {})} className={'sp-row' + (x.paidAt ? ' paid' : '')}>
                                    <span className="sp-facewrap"><Face m={m} />{x.paidAt && <i className="sp-paidmark">✓</i>}</span>
                                    <span className="sp-row-main">
                                      <span className="sp-row-top"><b>{x.userId === me ? myName : m.displayName}</b>{x.userId !== me && <span className="sp-badge ok">✓ {L('Aceitou')}</span>}</span>
                                      <small>{x.paidAt ? <span className="fx-pos">{L('Já pagou')} <b>{money(each ?? x.shareCents)}</b></span> : <>{L('Tem de pagar')} <b>{money(each ?? x.shareCents)}</b></>}</small>
                                    </span>
                                    {x.userId === me && <button type="button" className="sp-leave-row" onClick={(e) => { e.stopPropagation(); leave(); }}>{t('split.leave')}</button>}
                                  </Row>
                                );
                              })}
                              {allInv.map((i) => (
                                <div key={i.id} className={'sp-row inv' + (i.status === 'declined' ? ' no' : '')}>
                                  <span className="sp-face-ph">{i.status === 'declined' ? '✕' : '⏳'}</span>
                                  <span className="sp-row-main">
                                    <span className="sp-row-top"><b>{i.email ?? '+' + i.phone}</b><span className={'sp-badge ' + (i.status === 'declined' ? 'no' : 'wait')}>{i.status === 'declined' ? L('Rejeitou') : L('Pendente')}</span></span>
                                    <small>{i.status === 'declined' ? L('Não vai pagar esta conta') : <>{L('Vai pagar')} <b>{money(each ?? pr.eachCents)}</b> {L('quando aceitar')}</>}</small>
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div className="sp-bill-actions">
                              {mine && !mine.paidAt && mine.shareCents > 0 && <button type="button" className="fx-btn primary" onClick={() => setPaid(b, me, true)}>{t('split.iPaid', { amount: money(each ?? mine.shareCents) })}</button>}
                              {mine && mine.paidAt && <button type="button" className="fx-link" onClick={() => setPaid(b, me, false)}>{t('split.undoPaid')}</button>}

                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      <Sheet open={!!bill} onClose={() => { setBill(null); setInvDraft(''); }} title={t('split.newBill')}
        footer={bill ? <button type="button" className="tx-addbtn" disabled={!bill.description.trim() || !(parseMoneyToCents(bill.amount) ?? 0) || (bill.withGroup ? members.every((m) => bill.out.includes(m.userId)) : contactsOf(bill.invites).length === 0 || !myName.trim())} onClick={saveBill}>{t('common.add')}</button> : null}>
        {bill && (<>
          {error && <p className="fx-error">{error}</p>}
          <input className="tx-amt exp" autoFocus inputMode="decimal" value={bill.amount} placeholder="0" onChange={(e) => setBill({ ...bill, amount: e.target.value.replace(/[^\d.,]/g, '') })} aria-label={t('split.total')} />
          <span className="tx-cur">{group?.currency ?? s.currency}</span>
          {(() => { const c = parseMoneyToCents(bill.amount) ?? 0; const n = bill.withGroup ? members.filter((m) => !bill.out.includes(m.userId)).length : 1 + contactsOf(bill.invites).length; return c > 0 && n > 0 ? <p className="sp-each">{t('split.eachPays', { amount: money(Math.ceil(c / n)) })}</p> : null; })()}
          <div className="tx-rows">
            <label className="tx-row"><span><Ic d="M4 20h4L19 9l-4-4L4 16z" size={18} />{t('transactions.description')}</span>
              <input className="tx-val" value={bill.description} placeholder={t('split.billPh')} onChange={(e) => setBill({ ...bill, description: e.target.value })} /></label>
            <div className="tx-row"><span><Ic d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" size={18} />{t('transactions.category')}</span>
              <CategorySelect cats={expCats} kind="expense" value={bill.categoryId} onChange={(v) => setBill({ ...bill, categoryId: v })} ariaLabel={t('transactions.category')} emptyLabel={L('Escolher…')} className="fx-input tx-val" /></div>
            <div className="tx-row"><span><Ic d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4" size={18} />{t('transactions.date')}</span>
              <DatePicker value={bill.date} onChange={(v) => setBill({ ...bill, date: v })} ariaLabel={t('transactions.date')} /></div>
            <label className="tx-row"><span><Ic d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" size={18} />{L('Com quem?')}</span>
              <select className="tx-val" value={bill.withGroup} onChange={(e) => { const g = e.target.value; if (g) setSel(g); setBill({ ...bill, withGroup: g, out: [] }); }}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                {canCreate && <option value="">{L('Pessoas novas')}</option>}
              </select></label>
            {bill.withGroup ? members.map((m) => (
              <div key={m.userId} className="tx-row tx-sub"><span className="sp-toggle-who"><Face m={m} small />{m.userId === me ? t('family.you') : m.displayName}</span>
                <button type="button" role="switch" aria-checked={!bill.out.includes(m.userId)} className={'ob-toggle' + (!bill.out.includes(m.userId) ? ' on' : '')} onClick={() => setBill({ ...bill, out: bill.out.includes(m.userId) ? bill.out.filter((x) => x !== m.userId) : [...bill.out, m.userId] })} aria-label={m.displayName}><i /></button></div>
            )) : <>
              <div className="tx-row sp-invrow"><span><Ic d="M4 6h16v12H4zM4 7l8 6 8-6" size={18} />{t('split.inviteLabel')}</span>
                <div className="sp-chips">
                  {contactsOf(bill.invites).map((c) => <span key={c} className="sp-chip">{c}<button type="button" aria-label={t('common.delete')} onClick={() => setBill({ ...bill, invites: contactsOf(bill.invites).filter((x) => x !== c).join('\n') })}>×</button></span>)}
                  <input className={'tx-val sp-chipin' + (invDraft.trim() && !parseContact(invDraft) ? ' bad' : '')} value={invDraft} inputMode="email" placeholder={contactsOf(bill.invites).length ? L('Adicionar outro') : t('split.invitePh')}
                    onChange={(e) => setInvDraft(e.target.value)}
                    onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && invDraft.trim()) { e.preventDefault(); commitInvite(); } else if (e.key === 'Backspace' && !invDraft) { const l = contactsOf(bill.invites); setBill({ ...bill, invites: l.slice(0, -1).join('\n') }); } }}
                    onBlur={commitInvite} />
                </div></div>
            </>}
            <div className="tx-row"><span><Ic d="M20 6 9 17l-5-5" size={18} />{t('split.iPaidMine')}</span>
              <button type="button" role="switch" aria-checked={bill.iPaid} className={'ob-toggle' + (bill.iPaid ? ' on' : '')} onClick={() => setBill({ ...bill, iPaid: !bill.iPaid })} aria-label={t('split.iPaidMine')}><i /></button></div>
            {bill.iPaid && <div className="tx-row tx-sub"><span>{L('Adicionar a minha parte às minhas despesas')}</span>
              <button type="button" role="switch" aria-checked={bill.addMine} className={'ob-toggle' + (bill.addMine ? ' on' : '')} onClick={() => setBill({ ...bill, addMine: !bill.addMine })} aria-label={L('Adicionar a minha parte às minhas despesas')}><i /></button></div>}
          </div>
        </>)}
      </Sheet>

      {/* Registar a minha parte nas despesas: o mesmo formulário da "Nova transação" */}
      <Sheet open={!!personal} onClose={() => setPersonal(null)} title={L('Registar nas tuas despesas')}
        footer={<button type="button" className="tx-addbtn" disabled={!personal?.categoryId} onClick={savePersonal}>{L('Adicionar despesa')}</button>}>
        {personal && <>
          <p className="fx-muted fx-small" style={{ textAlign: 'center', margin: '0 0 4px' }}>{L('Pagaste a tua parte. Regista-a também nas tuas despesas.')}</p>
          <input className="tx-amt exp" inputMode="decimal" value={(personal.cents / 100).toFixed(2).replace('.', ',')}
            onChange={(e) => { const c = parseMoneyToCents(e.target.value); if (c !== null) setPersonal({ ...personal, cents: c }); }} aria-label={t('transactions.amount')} />
          <span className="tx-cur">{group?.currency ?? s.currency}</span>
          <div className="tx-rows">
            <label className="tx-row"><span><Ic d="M4 20h4L19 9l-4-4L4 16z" size={18} />{t('transactions.description')}</span>
              <input className="tx-val" value={personal.description} onChange={(e) => setPersonal({ ...personal, description: e.target.value })} /></label>
            <div className="tx-row"><span><Ic d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" size={18} />{t('transactions.category')}</span>
              <CategorySelect cats={expCats} kind="expense" value={personal.categoryId} onChange={(v) => setPersonal({ ...personal, categoryId: v })} ariaLabel={t('transactions.category')} emptyLabel={L('Escolher…')} className="fx-input tx-val" /></div>
            {accs.length > 0 && <div className="tx-row tx-acc"><span><Ic d={ICON.wallet} size={18} />{t('accounts.account')}</span>
              <span className="tx-accval"><span className="tx-accpick">
                <select className="tx-val" value={personal.accountId || defaultAccountId(accs) || ''} onChange={(e) => setPersonal({ ...personal, accountId: e.target.value })} aria-label={t('accounts.account')}>{accs.map((a2) => <option key={a2.id} value={a2.id}>{a2.name}</option>)}</select>
                {bals[personal.accountId || defaultAccountId(accs) || ''] !== undefined && <small className={bals[personal.accountId || defaultAccountId(accs) || ''] < 0 ? 'fx-neg' : 'fx-pos'}>{money(bals[personal.accountId || defaultAccountId(accs) || ''])}</small>}
              </span></span></div>}
            <div className="tx-row"><span><Ic d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4" size={18} />{t('transactions.date')}</span>
              <DatePicker value={personal.date} onChange={(v) => setPersonal({ ...personal, date: v })} className="fx-input tx-val" /></div>
          </div>
          <button type="button" className="sp-notnow" onClick={() => setPersonal(null)}>{t('split.personalNo')}</button>
        </>}
      </Sheet>
      {closing && (() => {
        const unpaid = closing.shares.filter((x) => !x.paidAt && x.shareCents > 0).length + outInv.length;
        return createPortal(
          <div className="spi-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setClosing(null); }}>
            <div className="spi-card" role="alertdialog" aria-modal="true">
              <span className="spi-face warn">!</span>
              <p className="spi-text">{L('Tens a certeza que queres fechar a conta')} <b>{closing.description}</b>?</p>
              {unpaid > 0 && <p className="spi-warn">{unpaid === 1 ? L('Ainda falta 1 pessoa pagar.') : L('Ainda faltam') + ' ' + unpaid + ' ' + L('pessoas pagar.')}</p>}
              <div className="spi-btns">
                <button type="button" className="spi-btn no" onClick={() => setClosing(null)}>{L('Cancelar')}</button>
                <button type="button" className="spi-btn danger" onClick={async () => { const b2 = closing; setClosing(null); await removeBill(b2); }}>{L('Fechar conta')}</button>
              </div>
            </div>
          </div>, document.body);
      })()}
    </div>
  );
}

/** Foto do membro (partilhada via set_split_avatar) ou a inicial num círculo colorido. */
function Face({ m, small }: { m: Member; small?: boolean }) {
  const hue = [...m.userId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const cls = 'fx-avatar sp-face' + (small ? ' sm' : '');
  if (m.avatarUrl) return <img className={cls} src={m.avatarUrl} alt="" referrerPolicy="no-referrer" />;
  return <span className={cls} style={{ background: `hsl(${hue} 55% 52%)` }} aria-hidden="true">{(m.displayName || '?').trim().charAt(0).toUpperCase()}</span>;
}
