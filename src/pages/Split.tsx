// Grupo dividido: todas as transações do grupo são divididas por todos. Uma só lista, com as fotos de quem já pagou
// e, ao tocar, quanto deve cada um. Os dados vêm do Supabase (supabase/split.sql).
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { avatarUrl } from '../core/avatar';
import { db } from '../db/app-db';
import type { Account, Category, Transaction } from '../db/database';
import { accountBalanceCents, defaultAccountId } from '../core/accounts';
import { addTransaction, softDelete } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { billProgress, groupSummary, parseContact, toBills, type SplitBill } from '../core/split';
import { SPLIT_CHANGED } from '../core/groupLink';
import { catFitsKind, CatIcon, Ic, ICON, Sheet } from '../ui/fx';
import { AccountRow, AmountField, CategoryRow, DateRow, InviteRow, TextRow } from '../ui/formFields';
import { useMissing } from '../ui/missing';
import { L } from '../i18n/phrases';
import { BottomSheet } from './SimplePages';

interface Member { userId: string; displayName: string; avatarUrl: string | null }
interface PendingOut { id: string; email: string | null; phone: string | null; status?: string }
type Personal = { description: string; cents: number; date: string; categoryId: string; accountId?: string };
const today = () => new Date().toLocaleDateString('sv-SE');
const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e);
const CLOCK = 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2', CHECK = 'M20 6 9 17l-5-5';

/** Foto com o estado no canto: certo verde (pagou) ou relógio amarelo (falta). */
function Who({ m, name, paid, wait }: { m: Member; name: string; paid?: boolean; wait?: boolean }) {
  return <span className={'gx-who' + (wait ? ' inv' : '')} title={name}><Face m={m} /><i className={paid ? 'ok' : 'wait'}><Ic d={paid ? CHECK : CLOCK} size={9} /></i></span>;
}

export function SplitGroup({ splitId, groupId, createdAt, local, cats, onChanged }: { splitId: string; groupId: string; createdAt: string; local: Transaction[]; cats: Category[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const me = auth.user?.id ?? '';
  const s = loadSettings();
  const [currency, setCurrency] = useState(s.currency);
  const [members, setMembers] = useState<Member[]>([]);
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [invs, setInvs] = useState<PendingOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string[] | null>(null);
  const [personal, setPersonal] = useState<Personal | null>(null);
  const [closing, setClosing] = useState<SplitBill | null>(null);
  const [accs, setAccs] = useState<Account[]>([]);
  const [bals, setBals] = useState<Record<string, number>>({});
  const money = (c: number) => formatMoney(c, currency, s.language);
  const day = (iso: string) => new Date(iso).toLocaleDateString(s.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const pending = invs.filter((i) => i.status !== 'declined');

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [g, m, b, i] = await Promise.all([
      sb.from('split_groups').select('*').eq('id', splitId).maybeSingle(),
      sb.from('split_members').select('*').eq('group_id', splitId).order('joined_at'),
      sb.from('split_bills').select('*').eq('group_id', splitId).is('deleted_at', null).order('date', { ascending: false }).limit(300),
      sb.from('split_invites').select('id, email, phone, status').eq('group_id', splitId).in('status', ['pending', 'declined']),
    ]);
    const ids = (b.data ?? []).map((x: { id: string }) => x.id);
    const sh = ids.length ? await sb.from('split_shares').select('*').in('bill_id', ids) : { data: [], error: null };
    const e = m.error || b.error || i.error || sh.error;
    setError(e ? errText(e) : null);
    if (g.data) setCurrency((g.data as { currency: string }).currency);
    setMembers((m.data ?? []).map((r: any) => ({ userId: r.user_id, displayName: r.display_name, avatarUrl: r.avatar_url ?? null })));
    setBills(toBills(b.data ?? [], sh.data ?? []));
    setInvs((i.data ?? []) as PendingOut[]);
  }, [splitId]);
  useEffect(() => {
    load().catch((e) => setError(errText(e)));
    const on = () => { load().catch(() => {}); };
    window.addEventListener(SPLIT_CHANGED, on);
    return () => window.removeEventListener(SPLIT_CHANGED, on);
  }, [load]);
  // a minha foto fica visível para o grupo (se a migração ainda não correu, ignora)
  const myAvatar = avatarUrl(auth.user);
  useEffect(() => { const sb = getSupabase(); if (sb && me) Promise.resolve(sb.rpc('set_split_avatar', { p_url: myAvatar })).catch(() => {}); }, [me, myAvatar]);
  useEffect(() => {
    (async () => {
      const live = <T extends { deletedAt: string | null }>(r: T[]) => r.filter((x) => x.deletedAt === null);
      const all = live(await db.accounts.toArray()), txs = live(await db.transactions.toArray()), trs = live(await db.transfers.toArray()), n = new Date();
      const sal = live(await db.salaries.toArray()).filter((x) => x.year * 100 + x.month <= n.getFullYear() * 100 + n.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
      setAccs(all.filter((a) => a.type !== 'debt'));
      setBals(Object.fromEntries(all.map((a) => [a.id, accountBalanceCents(a, txs, all, sal, trs)])));
    })().catch(() => {});
  }, []);

  const rpc = async (fn: string, args: Record<string, unknown>): Promise<boolean> => {
    const { error: e } = await getSupabase()!.rpc(fn, args);
    setError(e ? errText(e) : null);
    return !e;
  };
  const missingP = useMissing();
  const missP = missingP([['amount', L('o valor'), (personal?.cents ?? 0) > 0], ['category', L('a categoria'), !!personal?.categoryId]]);
  const closePersonal = () => { setPersonal(null); missP.reset(); };

  // parte de cada um, a contar já com quem ainda não aceitou
  const eachOf = (b: SplitBill) => (pending.length ? Math.ceil(b.amountCents / (b.shares.length + pending.length)) : 0);
  const shareOf = (b: SplitBill, uid: string) => eachOf(b) || (b.shares.find((x) => x.userId === uid)?.shareCents ?? 0);
  // a minha parte registada nas minhas transações, para não aparecer duas vezes
  const mineOf = (b: SplitBill) => local.find((x) => x.type === 'expense' && x.date === b.date && x.description === b.description && Math.abs(x.amountCents - shareOf(b, me)) <= 1)
    ?? local.find((x) => x.type === 'expense' && x.description === b.description && b.shares.some((y) => y.userId === me && Math.abs(y.shareCents - x.amountCents) <= 1));
  const mirrored = new Set(bills.map((b) => mineOf(b)?.id).filter(Boolean));
  const only = local.filter((x) => !mirrored.has(x.id));
  const nameOf = (id: string) => (id === me ? L('Tu') : members.find((m) => m.userId === id)?.displayName ?? '?');
  const memberOf = (id: string): Member => members.find((m) => m.userId === id) ?? { userId: id, displayName: nameOf(id), avatarUrl: null };
  const total = bills.reduce((a, b) => a + b.amountCents, 0) + only.reduce((a, x) => a + (x.type === 'expense' ? x.amountCents : -x.amountCents), 0);
  const sum = groupSummary(bills, me);
  const owe = bills.reduce((a, b) => a + (b.createdBy !== me && b.shares.some((x) => x.userId === me && !x.paidAt) ? shareOf(b, me) : 0), 0);

  const setPaid = async (b: SplitBill, uid: string, paid: boolean) => {
    if (!(await rpc('set_split_paid', { p_bill: b.id, p_user: uid, p_paid: paid }))) return;
    await load();
    const first = cats.find((c) => c.deletedAt === null && catFitsKind(c, 'expense'));
    if (paid && uid === me && !mineOf(b)) setPersonal({ description: b.description, cents: shareOf(b, me), date: today(), categoryId: first?.id ?? '' });
  };
  const savePersonal = async () => {
    if (!personal || !missP.check()) return;
    await addTransaction(db, { date: personal.date, type: 'expense', categoryId: personal.categoryId, description: personal.description, amountCents: personal.cents, currency, accountId: personal.accountId || defaultAccountId(accs) || undefined, groupId });
    closePersonal(); onChanged();
  };
  const removeBill = async (b: SplitBill) => {
    const { error: e } = await getSupabase()!.from('split_bills').update({ deleted_at: new Date().toISOString() }).eq('id', b.id);
    if (e) { setError(errText(e)); return; }
    const mine = mineOf(b);
    if (mine) await softDelete(db, 'transactions', mine.id); // a minha parte sai também das minhas transações
    await load(); onChanged();
  };
  const sendInvites = async () => {
    for (const raw of inviting ?? []) { const c = parseContact(raw)!; if (!(await rpc('invite_to_split', { p_group: splitId, p_email: c.email, p_phone: c.phone }))) return; }
    setInviting(null); await load();
  };

  return (
    <>
      <section className="mv-hero sh-hero grp-total">
        <small className="mv-hero-label">{L('Total do grupo')}</small>
        <div className="sh-big">{money(total)}</div>
        <div className="sh-row"><small className="sh-pct">{L('Criado a')} {day(createdAt)}</small>
          {owe > 0 ? <small className="fx-neg">{L('Tens de pagar')} <b>{money(owe)}</b></small> : sum.owedToMeCents > 0 ? <small className="fx-pos">{L('Têm de te pagar')} <b>{money(sum.owedToMeCents)}</b></small> : <small className="sh-pct">{L('Está tudo pago')}</small>}</div>
      </section>
      {error && <p className="fx-error">{error}</p>}

      <section className="mv-card gx-people">
        {members.map((m) => <span key={m.userId} className="gx-person"><Face m={m} /><b>{m.userId === me ? L('Tu') : m.displayName}</b></span>)}
        {invs.map((i) => <span key={i.id} className={'gx-person ' + (i.status === 'declined' ? 'no' : 'wait')}><span className="sp-face-ph"><Ic d={i.status === 'declined' ? ICON.close : CLOCK} size={17} /></span><b>{i.email ?? '+' + i.phone}</b><small>{i.status === 'declined' ? L('Rejeitou') : L('Pendente')}</small></span>)}
        <button type="button" className="gx-person add" onClick={() => setInviting([])}><span className="sp-face-ph"><Ic d={ICON.plus} size={18} /></span><b>{L('Convidar')}</b></button>
      </section>

      <section className="mv-card">
        <div className="mv-card-head"><h2>{L('Transações')}</h2><Link to={`/transacoes?nova=1&grupo=${groupId}`} className="sh-btn in sm grp-add"><Ic d={ICON.plus} size={16} />{L('Adicionar transação')}</Link></div>
        {bills.length + only.length === 0 && <p className="fx-muted">{L('Tudo o que adicionares aqui é dividido por todos.')}</p>}
        {bills.map((b) => {
          const pr = billProgress(b), mine = mineOf(b), share = b.shares.find((x) => x.userId === me), ex = open === b.id;
          const left = eachOf(b) ? Math.max(0, b.amountCents - b.shares.filter((x) => x.paidAt).length * eachOf(b)) : pr.remainingCents;
          return (
            <div key={b.id} className="gx-item">
              <button type="button" className="sh-tx gx-row" aria-expanded={ex} onClick={() => setOpen(ex ? null : b.id)}>
                <CatIcon cat={cats.find((c) => c.id === mine?.categoryId) ?? {}} size={36} />
                <span className="sh-tx-main"><b>{b.description}</b><small>{day(b.date)} · {nameOf(b.createdBy)}</small></span>
                <b>−{money(b.amountCents)}</b><span className="gx-chev"><Ic d={ICON.down} size={16} /></span>
              </button>
              <div className="gx-faces">
                {b.shares.map((x) => <Who key={x.userId} m={memberOf(x.userId)} name={nameOf(x.userId)} paid={!!x.paidAt} />)}
                {pending.map((i) => <Who key={i.id} wait m={{ userId: i.id, displayName: i.email ?? i.phone ?? '?', avatarUrl: null }} name={i.email ?? '+' + i.phone} />)}
                <small>{left > 0 ? `${L('Falta')} ${money(left)}` : L('Tudo pago ✓')}</small>
              </div>
              <div className={'acc-exp' + (ex ? ' open' : '')} aria-hidden={!ex} inert={!ex}><div><div className="gx-more">
                <div className="pl-tiles">
                  <div className="pl-tile"><small>{L('Total')}</small><b>{money(b.amountCents)}</b></div>
                  <div className="pl-tile"><small>{L('Cada um paga')}</small><b>{money(eachOf(b) || pr.eachCents)}</b></div>
                  <div className="pl-tile"><small>{L('Já pago')}</small><b className="fx-pos">{money(b.amountCents - left)}</b></div>
                  <div className="pl-tile"><small>{L('Falta')}</small><b className={left > 0 ? 'fx-neg' : ''}>{money(left)}</b></div>
                </div>
                <div className="sp-list">
                  {b.shares.map((x) => {
                    const can = b.createdBy === me && x.userId !== me, R = can ? 'button' : 'div';
                    return (
                      <R key={x.userId} {...(can ? { type: 'button' as const, onClick: () => setPaid(b, x.userId, !x.paidAt), title: x.paidAt ? t('split.markUnpaid') : t('split.markPaid') } : {})} className={'sp-row' + (x.paidAt ? ' paid' : '')}>
                        <span className="sp-facewrap"><Face m={memberOf(x.userId)} />{x.paidAt && <i className="sp-paidmark">✓</i>}</span>
                        <span className="sp-row-main"><span className="sp-row-top"><b>{nameOf(x.userId)}</b></span><small>{x.paidAt ? <span className="fx-pos">{L('Já pagou')} <b>{money(shareOf(b, x.userId))}</b></span> : <>{L('Tem de pagar')} <b>{money(shareOf(b, x.userId))}</b></>}</small></span>
                        <span className={'sp-badge ' + (x.paidAt ? 'ok' : 'wait')}>{x.paidAt ? L('Pago') : can ? L('Marcar como pago') : L('Por pagar')}</span>
                      </R>
                    );
                  })}
                  {pending.map((i) => <div key={i.id} className="sp-row inv"><span className="sp-face-ph"><Ic d={CLOCK} size={17} /></span><span className="sp-row-main"><span className="sp-row-top"><b>{i.email ?? '+' + i.phone}</b></span><small>{L('Vai pagar')} <b>{money(eachOf(b))}</b> {L('quando aceitar')}</small></span><span className="sp-badge wait">{L('Pendente')}</span></div>)}
                </div>
                <div className="debt-btns">
                  {share && !share.paidAt && <button type="button" className="sh-btn in sm" onClick={() => setPaid(b, me, true)}>{t('split.iPaid', { amount: money(shareOf(b, me)) })}</button>}
                  {share?.paidAt && <button type="button" className="sh-btn out sm" onClick={() => setPaid(b, me, false)}>{t('split.undoPaid')}</button>}
                  {b.createdBy === me && <button type="button" className="sh-btn out sm gx-del" onClick={() => setClosing(b)}>{L('Apagar')}</button>}
                </div>
              </div></div></div>
            </div>
          );
        })}
        {only.map((x) => <div key={x.id} className="gx-item"><div className="sh-tx"><CatIcon cat={cats.find((c) => c.id === x.categoryId) ?? {}} size={36} /><span className="sh-tx-main"><b>{x.description || '—'}</b><small>{day(x.date)} · {L('só tua')}</small></span><b className={x.type === 'income' ? 'fx-pos' : ''}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</b></div></div>)}
      </section>

      {inviting && <BottomSheet title={L('Convidar')} onClose={() => setInviting(null)}>
        <div className="acc-form"><div className="tx-rows"><InviteRow value={inviting} onChange={setInviting} /></div>
          <p className="grp-hint">{L('Usa o email ou o número de telemóvel da conta da pessoa no FuturePal.')}</p>
          <button type="button" className="tx-addbtn" disabled={inviting.length === 0} onClick={sendInvites}>{L('Enviar convite')}</button></div>
      </BottomSheet>}

      {/* Paguei a minha parte: fica também nas minhas despesas (e no total deste grupo) */}
      <Sheet open={!!personal} onClose={closePersonal} title={L('Registar nas tuas despesas')}
        footer={<div className="sp-pfoot"><button type="button" className="sp-pbtn no" onClick={closePersonal}>{t('split.personalNo')}</button><button type="button" className="sp-pbtn yes" onClick={savePersonal}>{L('Adicionar despesa')}</button></div>}>
        {personal && <>
          {missP.note}
          <p className="fx-muted fx-small" style={{ textAlign: 'center', margin: '0 0 4px' }}>{L('Pagaste a tua parte. Regista-a também nas tuas despesas.')}</p>
          <AmountField kind="expense" value={(personal.cents / 100).toFixed(2).replace('.', ',')} onChange={(v) => { const c = parseMoneyToCents(v); if (c !== null) setPersonal({ ...personal, cents: c }); }} currency={currency} cls={missP.cls('amount')} />
          <div className="tx-rows">
            <TextRow label={t('transactions.description')} value={personal.description} onChange={(v) => setPersonal({ ...personal, description: v })} />
            <CategoryRow required cats={cats.filter((c) => c.deletedAt === null)} kind="expense" value={personal.categoryId} onChange={(v) => setPersonal({ ...personal, categoryId: v })} cls={missP.cls('category')} />
            {accs.length > 0 && (() => { const aid = personal.accountId || defaultAccountId(accs) || ''; return <AccountRow label={t('accounts.account')} value={aid} options={accs.map((a) => ({ id: a.id, name: a.name, right: bals[a.id] !== undefined ? money(bals[a.id]) : undefined }))} balance={bals[aid] !== undefined ? money(bals[aid]) : undefined} onChange={(v) => setPersonal({ ...personal, accountId: v })} />; })()}
            <DateRow label={t('transactions.date')} value={personal.date} onChange={(v) => setPersonal({ ...personal, date: v })} />
          </div>
        </>}
      </Sheet>
      {closing && (() => {
        const unpaid = closing.shares.filter((x) => !x.paidAt && x.shareCents > 0).length + pending.length;
        return createPortal(
          <div className="spi-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setClosing(null); }}>
            <div className="spi-card" role="alertdialog" aria-modal="true">
              <span className="spi-face warn">!</span>
              <p className="spi-text">{L('Tens a certeza que queres apagar')} <b>{closing.description}</b>?</p>
              {unpaid > 0 && <p className="spi-warn">{unpaid === 1 ? L('Ainda falta 1 pessoa pagar.') : L('Ainda faltam') + ' ' + unpaid + ' ' + L('pessoas pagar.')}</p>}
              <div className="spi-btns">
                <button type="button" className="spi-btn no" onClick={() => setClosing(null)}>{L('Cancelar')}</button>
                <button type="button" className="spi-btn danger" onClick={async () => { const b2 = closing; setClosing(null); await removeBill(b2); }}>{L('Apagar')}</button>
              </div>
            </div>
          </div>, document.body);
      })()}
    </>
  );
}

function Face({ m, small }: { m: Member; small?: boolean }) {
  const hue = [...m.userId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const cls = 'fx-avatar sp-face' + (small ? ' sm' : '');
  if (m.avatarUrl) return <img className={cls} src={m.avatarUrl} alt="" referrerPolicy="no-referrer" />;
  return <span className={cls} style={{ background: `hsl(${hue} 55% 52%)` }} aria-hidden="true">{(m.displayName || '?').trim().charAt(0).toUpperCase()}</span>;
}
