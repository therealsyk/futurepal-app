// Grupos (ex.: "Férias Maldivas"): juntam transações, mostram o total e, se a pessoa quiser, dividem as despesas com outras pessoas.
// Um grupo dividido tem o id "sp_<grupo da divisão>_<pessoa>": é assim que se liga ao sistema de divisão de contas.
import { useEffect, useState } from 'react';
import { appConfirm } from '../ui/confirm';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSupabase } from '../auth/supabase';
import { db } from '../db/app-db';
import type { Category, Group, Transaction } from '../db/database';
import { addGroup } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { linkedGroupId, SPLIT_CHANGED, splitIdOf } from '../core/groupLink';
import { CatIcon, catLabel, Ic, ICON } from '../ui/fx';
import { addSplitTransaction, putMyShare } from '../core/splitInvite';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../ui/EmptyState';
import { FI, InviteRow, SwitchRow, TextRow } from '../ui/formFields';
import { parseContact } from '../core/split';
import { usePlan } from './Premium';
import { useMissing } from '../ui/missing';
import { IS_DEMO } from '../demo/demo';
import { BottomSheet } from './SimplePages';
import { SplitGroup } from './Split';
import { L } from '../i18n/phrases';

const COLORS = ['#17c3c9', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#ec4899'];

export function Groups() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const auth = useAuth();
  const me = auth.user?.id ?? '';
  const { id } = useParams();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const day = (iso: string) => new Date(iso).toLocaleDateString(s.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const [groups, setGroups] = useState<Group[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [shared, setShared] = useState<Record<string, { cents: number; n: number }>>({}); // total e número de transações de cada grupo dividido
  const [name, setName] = useState('');
  const [adding, setAdding] = useState<'new' | Group | null>(null); // grupo novo, ou um que já existe e passa a ser dividido
  const [split, setSplit] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { has } = usePlan();
  const missing = useMissing();
  const miss = missing([['name', L('o nome'), !!name.trim()], ['people', L('quem queres convidar'), !split || people.length > 0]]);

  const load = async () => {
    setGroups((await db.groups.toArray()).filter((g) => g.deletedAt === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setTxs((await db.transactions.toArray()).filter((x) => x.deletedAt === null && x.groupId));
    setCats(await db.categories.toArray());
  };
  useEffect(() => {
    load().catch(() => {});
    const sb = getSupabase();
    if (!sb || !me || IS_DEMO) return;
    // divisões em que já estou (ou que aceitei): cada uma aparece como um grupo, uma só vez
    const pull = async () => {
      const { data } = await sb.from('split_groups').select('id, name, created_at');
      const bl = await sb.from('split_bills').select('group_id, amount_cents').is('deleted_at', null);
      const sum: Record<string, { cents: number; n: number }> = {};
      for (const b of (bl.data ?? []) as Array<{ group_id: string; amount_cents: number }>) { const k = (sum[b.group_id] ??= { cents: 0, n: 0 }); k.cents += Number(b.amount_cents); k.n++; }
      setShared(sum);
      const have = new Set((await db.groups.toArray()).map((g) => g.id)); // inclui os apagados: não voltam
      let n = have.size;
      for (const g of (data ?? []) as Array<{ id: string; name: string; created_at: string }>) {
        const gid = linkedGroupId(g.id, me);
        if (!have.has(gid)) await db.groups.put({ id: gid, name: g.name, color: COLORS[n++ % COLORS.length], createdAt: g.created_at, updatedAt: new Date().toISOString(), deletedAt: null });
      }
      await load();
    };
    const on = () => { pull().catch(() => {}); };
    on();
    window.addEventListener(SPLIT_CHANGED, on);
    return () => window.removeEventListener(SPLIT_CHANGED, on);
  }, [me, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const of = (g: string) => txs.filter((x) => x.groupId === g);
  const total = (g: string) => of(g).reduce((a, x) => a + (x.type === 'expense' ? x.amountCents : -x.amountCents), 0);
  const sharedOf = (id2: string) => { const k = splitIdOf(id2); return k ? shared[k] : undefined; };
  const count = (n: number) => `${n} ${n === 1 ? L('movimento') : L('movimentos')}`;
  const close = () => { setAdding(null); setName(''); setSplit(false); setPeople([]); miss.reset(); };
  // cria o grupo da divisão e envia os convites; devolve o id
  const startSplit = async (): Promise<string | null> => {
    const sb = getSupabase();
    if (!sb || !auth.user) return null;
    const m = (auth.user.user_metadata ?? {}) as { full_name?: string; name?: string };
    const g = await sb.rpc('create_split_group', { p_name: name.trim(), p_display_name: m.full_name || m.name || (auth.user.email ?? '').split('@')[0], p_currency: s.currency });
    if (g.error) { await appConfirm(g.error.message, { ok: 'OK' }); return null; }
    const bad: string[] = [];
    for (const raw of people) { const c = parseContact(raw)!; const r = await sb.rpc('invite_to_split', { p_group: String(g.data), p_email: c.email, p_phone: c.phone }); if (r.error) bad.push(`${raw}: ${r.error.message}`); }
    if (bad.length) await appConfirm(`${L('O grupo foi criado, mas estes convites falharam:')} ${bad.join('; ')}`, { ok: 'OK' });
    return String(g.data);
  };
  const create = async () => {
    if (!miss.check() || busy) return;
    setBusy(true);
    try {
      const sid = split ? await startSplit() : null;
      if (split && !sid) return;
      if (adding && adding !== 'new') { const g = adding; close(); if (sid) await link(g, sid); return; }
      let gid: string;
      if (sid) { gid = linkedGroupId(sid, me); const n = new Date().toISOString(); await db.groups.put({ id: gid, name: name.trim(), color: COLORS[groups.length % COLORS.length], createdAt: n, updatedAt: n, deletedAt: null }); }
      else gid = (await addGroup(db, name.trim(), COLORS[groups.length % COLORS.length])).id;
      close(); await load(); navigate(`/grupos/${gid}`);
    } finally { setBusy(false); }
  };
  const drop = async (g: Group) => {
    const now = new Date().toISOString();
    await db.groups.update(g.id, { deletedAt: now, updatedAt: now });
    for (const x of of(g.id)) await db.transactions.update(x.id, { groupId: undefined, updatedAt: now });
    navigate('/grupos'); await load();
  };
  const remove = async (g: Group) => { if (await appConfirm(`${L('Apagar grupo')} "${g.name}"? ${L('As despesas ficam, só deixam de estar no grupo.')}`)) await drop(g); };
  // o grupo passa a ser dividido: muda de id (para ficar ligado) e leva as suas transações
  const link = async (g: Group, splitId: string) => {
    const now = new Date().toISOString(), gid = linkedGroupId(splitId, me);
    await db.transaction('rw', [db.groups, db.transactions, db.recurrings], async () => {
      await db.groups.put({ ...g, id: gid, updatedAt: now });
      for (const x of await db.transactions.toArray()) if (x.groupId === g.id) await db.transactions.update(x.id, { groupId: gid, updatedAt: now });
      if (gid !== g.id) await db.groups.update(g.id, { deletedAt: now, updatedAt: now });
    });
    for (const x of (await db.transactions.toArray()).filter((y) => y.groupId === gid && y.deletedAt === null)) {
      if (x.type === 'income') { await db.transactions.update(x.id, { groupId: undefined, updatedAt: now }); continue; }
      const c = cats.find((y) => y.id === x.categoryId), desc = x.description || (c ? catLabel(t, c) : L('Despesa'));
      const r = await addSplitTransaction(splitId, desc, x.amountCents, x.date);
      if ('error' in r) { await appConfirm(r.error, { ok: 'OK' }); break; }
      await putMyShare(db, r.billId, me, { date: x.date, type: 'expense', categoryId: x.categoryId, description: desc, amountCents: r.share, currency: x.currency, accountId: x.accountId, groupId: gid });
      await db.transactions.update(x.id, { deletedAt: now, updatedAt: now, groupId: undefined });
    }
    await load(); navigate(`/grupos/${gid}`, { replace: true });
  };

  const sheet = adding && (
    <BottomSheet title={adding === 'new' ? L('Novo grupo') : adding.name} onClose={close}>
      <div className="acc-form">
        {miss.note}
        <div className="tx-rows">
          {adding === 'new' && <TextRow icon={FI.name} label={L('Nome')} value={name} onChange={setName} placeholder={L('Ex.: Férias de verão')} cls={miss.cls('name')} />}
          {!IS_DEMO && adding === 'new' && <SwitchRow icon="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" label={L('Dividir despesas com outras pessoas?')} sub={split ? undefined : L('Cada um paga a sua parte e vê quem já pagou')} on={split} onChange={setSplit} />}
          {split && (me && has('split') ? <InviteRow value={people} onChange={setPeople} cls={miss.cls('people')} /> : null)}
        </div>
        {split && adding !== 'new' && of(adding.id).length > 0 && <p className="grp-hint">{L('As despesas que já estão neste grupo passam a ser divididas por todos.')}</p>}
        {split && me && has('split') && <p className="grp-hint">{L('Usa o email ou o número de telemóvel da conta da pessoa no FuturePal.')}</p>}
        {split && !(me && has('split')) && <div className="mv-card sp-start"><p>{me ? L('Criar grupos para dividir despesas faz parte do Plus e do Pro.') : L('Inicia sessão para convidares pessoas e dividires as despesas deste grupo.')}</p><Link to={me ? '/plus' : '/definicoes'} className="sh-btn out sm">{me ? L('Ver planos') : L('Iniciar sessão')}</Link></div>}
        <button type="button" className="tx-addbtn" disabled={busy || (split && !(me && has('split')))} onClick={create}>{adding === 'new' ? L('Criar grupo') : L('Convidar')}</button>
      </div>
    </BottomSheet>
  );

  const open = groups.find((g) => g.id === id);
  if (open) {
    const list = of(open.id).sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div className="fx-page mv sh grp">
        <header className="mv-head"><Link to="/grupos" className="mv-sq" aria-label={L('Voltar')}><Ic d={ICON.left} size={20} /></Link><h1 className="sh-title">{open.name}</h1></header>
        {splitIdOf(open.id) && !IS_DEMO ? <SplitGroup key={open.id} splitId={splitIdOf(open.id)!} groupId={open.id} createdAt={open.createdAt} local={list} cats={cats} onChanged={() => { load().catch(() => {}); }} onGone={() => drop(open)} /> : <>
        <section className="mv-hero sh-hero grp-total">
          <small className="mv-hero-label">{L('Total')}</small>
          <div className="sh-big">{money(total(open.id))}</div>
          <div className="sh-row"><small className="sh-pct">{L('Criado a')} {day(open.createdAt)}</small><small className="sh-pct">{count(list.length)}</small></div>
        </section>
        <section className="mv-card">
          <div className="mv-card-head"><h2>{L('Transações')}</h2><Link to={`/transacoes?nova=1&grupo=${open.id}`} className="sh-btn in sm grp-add"><Ic d={ICON.plus} size={16} />{L('Adicionar transação')}</Link></div>
          {list.length === 0 ? <p className="fx-muted">{L('Adiciona transações a este grupo para veres quanto custa no total.')}</p> : list.map((x) => {
            const c = cats.find((y) => y.id === x.categoryId);
            return <div key={x.id} className="sh-tx"><CatIcon cat={c ?? {}} size={36} /><span className="sh-tx-main"><b>{x.description || '—'}</b><small>{day(x.date)}</small></span><b className={x.type === 'income' ? 'fx-pos' : 'fx-neg'}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</b></div>;
          })}
        </section>
        </>}
        {!IS_DEMO && !splitIdOf(open.id) && <button type="button" className="fx-link grp-start" onClick={() => { setName(open.name); setSplit(true); setAdding(open); }}>{L('Dividir este grupo com outras pessoas')}</button>}
        {!splitIdOf(open.id) && <button type="button" className="sh-danger" onClick={() => remove(open)}>{L('Apagar grupo')}</button>}
        {sheet}
      </div>
    );
  }

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">{L('Grupos')}</h1></header>
      <p className="fx-muted" style={{ margin: 0 }}>{L('Junta as transações de uma coisa só (férias, obras, jantares), vê o total e divide com quem quiseres.')}</p>
      {groups.length === 0 && <EmptyState icon="M4 6h16M4 12h16M4 18h10" title={L('Ainda não tens grupos')} text={L('Junta despesas de uma coisa só e vê quanto custou no total.')} examples={['✈️ Viagem', '🔨 Obras', '🎄 Natal']} />}
      <div className="sh-groups-grid">
        {groups.map((g) => (
          <Link key={g.id} to={`/grupos/${g.id}`} className="sh-group" style={{ ['--g' as string]: g.color }}>
            <b>{g.name}</b><span>{money(sharedOf(g.id)?.cents ?? total(g.id))}</span><small>{count(sharedOf(g.id)?.n ?? of(g.id).length)}{splitIdOf(g.id) ? ` · ${L('Dividido')}` : ''}</small>
          </Link>
        ))}
      </div>
      <button type="button" className="sh-btn in" onClick={() => setAdding('new')}><Ic d={ICON.plus} size={20} />{L('Novo grupo')}</button>
      {sheet}
    </div>
  );
}
