// Grupos (ex.: "Férias Maldivas"): juntam transações, mostram o total e, se a pessoa quiser, dividem as despesas com outras pessoas.
// Um grupo dividido tem o id "sp_<grupo da divisão>_<pessoa>": é assim que se liga ao sistema de divisão de contas.
import { useEffect, useState, type CSSProperties } from 'react';
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
import { FormError, useMissing } from '../ui/missing';
import { squareImage } from '../core/assistant';
import { listenSplit, tellSplit } from '../core/splitLive';
import { IS_DEMO } from '../demo/demo';
import { BottomSheet } from './SimplePages';
import { CALENDAR, EMPTY_IC, Face, GTile, SplitGroup, type Member, type SplitEditInfo } from './Split';
import { openTxForm, useTxSaved } from '../ui/TxForm';
import { L } from '../i18n/phrases';

// Ícone do cartão: adivinhado pelo nome do grupo (senão, um ícone neutro)
const KINDS: Array<[RegExp, string]> = [
  [/f[eé]rias|viag|praia|maldivas|algarve|voo|hotel|trip|travel|holiday|vacac|voyage|vacance/i, 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z'],
  [/jantar|almo[cç]o|natal|comida|restaurante|festa|anivers|dinner|lunch|food|party|christmas|cena|comida|navidad|d[iî]ner|repas|no[eë]l/i, 'M6 3v7a3 3 0 0 0 6 0V3M9 3v18M18 3c-2 1-3 4-3 7v3h3zM18 13v8'],
  [/casa|renda|apartamento|obra|quarto|lisboa|porto|home|house|rent|flat|piso|alquiler|maison|loyer/i, 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10'],
  [/carro|auto|gasolina|car\b|coche|voiture/i, 'M5 17H3v-5l2-5h14l2 5v5h-2M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0M9 17h6M3 12h18'],
];
const iconOf = (name: string) => KINDS.find(([re]) => re.test(name))?.[1] ?? 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5';

/** Foto do grupo ou, sem foto, o ícone na cor dele. */
export function GroupPic({ name, image, big }: { name: string; image?: string; big?: boolean }) {
  return <span className={'gg-ic' + (big ? ' big' : '') + (image ? ' pic' : '')}>{image ? <img src={image} alt="" /> : <Ic d={iconOf(name)} size={big ? 62 : 30} />}</span>;
}

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
  const [crew, setCrew] = useState<Record<string, { members: Member[]; pending: number; due: boolean }>>({}); // pessoas de cada grupo dividido
  const [alive, setAlive] = useState<Set<string> | null>(null); // divisões que existem mesmo (null = ainda não se sabe)
  const [name, setName] = useState('');
  const [adding, setAdding] = useState<'new' | Group | null>(null); // grupo novo, ou um que já existe e passa a ser dividido
  const [split, setSplit] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Group | null>(null), [color, setColor] = useState(''), [image, setImage] = useState(''), [picErr, setPicErr] = useState('');
  const pickPhoto = async (f?: File) => { if (!f) return; try { setImage(await squareImage(f)); setPicErr(''); } catch { setPicErr(L('Não foi possível abrir esta foto. Experimenta outra (JPG ou PNG).')); } };
  const missing = useMissing(), emissing = useMissing();
  const emiss = emissing([['name', L('o nome'), !!name.trim()]]);
  const [info, setInfo] = useState<SplitEditInfo | null>(null), [allow, setAllow] = useState(false), [eds, setEds] = useState<string[]>([]); // grupo partilhado: quem mais o pode alterar
  // grupo partilhado: o servidor guarda e todos passam a ver o mesmo
  const pushGroup = async (sid: string, f: { name: string; color: string; image?: string }): Promise<string | null> => {
    const { error } = await getSupabase()!.rpc('update_split_group', { p_group: sid, p_name: f.name.slice(0, 80), p_color: f.color, p_image: f.image ?? '' });
    if (!error) tellSplit(sid);
    return error ? (/update_split_group|set_split_editors|schema cache/i.test(error.message) ? L('O servidor ainda não está atualizado. Tenta mais tarde.') : error.message) : null;
  };
  const saveEdit = async () => {
    if (!edit || !emiss.check()) return;
    const f = { name: name.trim().slice(0, 80), color, image }, sid = splitOf(edit.id);
    if (sid) {
      if (info?.owner) {
        const { error } = await getSupabase()!.rpc('set_split_editors', { p_group: sid, p_users: allow ? eds : [] });
        if (error) { setPicErr(/set_split_editors|schema cache/i.test(error.message) ? L('O servidor ainda não está atualizado. Tenta mais tarde.') : error.message); return; }
      }
      const e = await pushGroup(sid, f);
      if (e) { setPicErr(e); return; }
    }
    await db.groups.update(edit.id, { ...f, updatedAt: new Date().toISOString() });
    closeEdit(); await load();
    if (sid) window.dispatchEvent(new Event(SPLIT_CHANGED));
  };
  const closeEdit = () => { setEdit(null); setInfo(null); setName(''); emiss.reset(); };
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
      const { data } = await sb.from('split_groups').select('*');
      const bl = await sb.from('split_bills').select('id, group_id, amount_cents').is('deleted_at', null);
      const sum: Record<string, { cents: number; n: number }> = {};
      for (const b of (bl.data ?? []) as Array<{ group_id: string; amount_cents: number }>) { const k = (sum[b.group_id] ??= { cents: 0, n: 0 }); k.cents += Number(b.amount_cents); k.n++; }
      setShared(sum);
      if (data) setAlive(new Set((data as Array<{ id: string }>).map((g) => g.id)));
      const [mb, iv, mine] = await Promise.all([
        sb.from('split_members').select('*').order('joined_at'),
        sb.from('split_invites').select('group_id').eq('status', 'pending'),
        sb.from('split_shares').select('bill_id, paid_at').eq('user_id', me).is('paid_at', null),
      ]);
      const ppl: typeof crew = {};
      for (const r of (mb.data ?? []) as Array<{ group_id: string; user_id: string; display_name: string; avatar_url?: string | null }>) (ppl[r.group_id] ??= { members: [], pending: 0, due: false }).members.push({ userId: r.user_id, displayName: r.display_name, avatarUrl: r.avatar_url ?? null });
      for (const r of (iv.data ?? []) as Array<{ group_id: string }>) if (ppl[r.group_id]) ppl[r.group_id].pending++;
      const billGroup = new Map(((bl.data ?? []) as Array<{ id: string; group_id: string }>).map((b) => [b.id, b.group_id]));
      for (const r of (mine.data ?? []) as Array<{ bill_id: string }>) { const k = ppl[billGroup.get(r.bill_id) ?? '']; if (k) k.due = true; }
      setCrew(ppl);
      const have = new Set((await db.groups.toArray()).map((g) => g.id)); // inclui os apagados: não voltam
      let n = have.size;
      for (const g of (data ?? []) as Array<{ id: string; name: string; created_at: string; color?: string | null; image?: string | null }>) {
        const gid = linkedGroupId(g.id, me), old = await db.groups.get(gid);
        if (old && old.deletedAt === null) { // nome, cor e foto são os que o criador escolheu
          const now = { name: g.name, color: g.color ?? old.color, image: g.image ?? old.image };
          if (now.name !== old.name || now.color !== old.color || (now.image ?? '') !== (old.image ?? '')) await db.groups.update(gid, { ...now, updatedAt: new Date().toISOString() });
        }
        if (!have.has(gid)) await db.groups.put({ id: gid, name: g.name, color: g.color ?? COLORS[n++ % COLORS.length], image: g.image ?? undefined, createdAt: g.created_at, updatedAt: new Date().toISOString(), deletedAt: null });
      }
      await load();
    };
    const on = () => { pull().catch(() => {}); };
    on();
    window.addEventListener(SPLIT_CHANGED, on);
    return () => window.removeEventListener(SPLIT_CHANGED, on);
  }, [me, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useTxSaved(() => { load().catch(() => {}); });
  // em direto: uma transação, um nome ou uma foto nova aparecem logo a todos
  const liveIds = alive ? [...alive].sort().join(',') : '';
  useEffect(() => listenSplit(liveIds ? liveIds.split(',') : []), [liveIds]);
  const of = (g: string) => txs.filter((x) => x.groupId === g);
  const total = (g: string) => of(g).reduce((a, x) => a + (x.type === 'expense' ? x.amountCents : -x.amountCents), 0);
  const splitOf = (gid: string) => { const k = splitIdOf(gid); return k && (!alive || alive.has(k)) ? k : null; }; // divisão apagada: volta a ser um grupo normal
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
      if (sid) { gid = linkedGroupId(sid, me); const n = new Date().toISOString(), color = COLORS[groups.length % COLORS.length]; await pushGroup(sid, { name: name.trim(), color }); await db.groups.put({ id: gid, name: name.trim(), color, createdAt: n, updatedAt: n, deletedAt: null }); }
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
    await pushGroup(splitId, g);
    await load(); navigate(`/grupos/${gid}`, { replace: true });
  };

  const sheet = adding && (
    <BottomSheet title={adding === 'new' ? L('Novo grupo') : adding.name} onClose={close}>
      <div className="acc-form">
        {miss.note}
        <div className="tx-rows">
          {adding === 'new' && <TextRow icon={FI.name} label={L('Nome')} value={name} onChange={setName} placeholder={L('Ex.: Férias de verão')} cls={miss.cls('name')} />}
          {!IS_DEMO && adding === 'new' && <SwitchRow icon="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" label={L('Dividir despesas com outras pessoas?')} sub={split ? undefined : L('Cada um paga a sua parte e vê quem já pagou')} on={split} onChange={setSplit} />}
          {split && (me ? <InviteRow value={people} onChange={setPeople} cls={miss.cls('people')} /> : null)}
        </div>
        {split && adding !== 'new' && of(adding.id).length > 0 && <p className="grp-hint">{L('As despesas que já estão neste grupo passam a ser divididas por todos.')}</p>}
        {split && !me && <div className="mv-card sp-start"><p>{L('Inicia sessão para convidares pessoas e dividires as despesas deste grupo.')}</p><Link to="/definicoes" className="sh-btn out sm">{L('Iniciar sessão')}</Link></div>}
        <button type="button" className="tx-addbtn" disabled={busy || (split && !me)} onClick={create}>{adding === 'new' ? L('Criar grupo') : L('Convidar')}</button>
      </div>
    </BottomSheet>
  );

  const open = groups.find((g) => g.id === id);
  if (open) {
    const startEdit = () => { setName(open.name); setColor(open.color); setImage(open.image ?? ''); setPicErr(''); setEdit(open); };
    const list = of(open.id).sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div className="fx-page mv sh grp gl-page">
        <header className="mv-head"><Link to="/grupos" className="mv-sq" aria-label={L('Voltar')}><Ic d={ICON.left} size={20} /></Link><h1 className="sh-title">{open.name}</h1></header>
        {splitOf(open.id) && !IS_DEMO ? <SplitGroup key={open.id} splitId={splitIdOf(open.id)!} groupId={open.id} createdAt={open.createdAt} color={open.color} pic={<GroupPic name={open.name} image={open.image} big />} onEdit={(x) => { setInfo(x); setEds(x.editors); setAllow(x.editors.length > 0); startEdit(); }} local={list} cats={cats} onChanged={() => { load().catch(() => {}); }} onGone={() => drop(open)} /> : <>
        <section className="mv-hero sh-hero gl-hero gg-hero" style={{ '--g': open.color } as CSSProperties}>
          <GroupPic name={open.name} image={open.image} big />
          <div className="gl-sum">
            <div className="gl-have"><small>{L('Total do grupo')}</small><b>{money(total(open.id))}</b><small>{count(list.length)}</small></div>
            <div className="gl-acts">
              <button type="button" className="gl-act main" onClick={() => openTxForm({ type: 'expense', groupId: open.id })}><Ic d={ICON.plus} size={18} />{L('Adicionar transação')}</button>
              {!IS_DEMO && <button type="button" className="gl-act" onClick={() => { setName(open.name); setSplit(true); setAdding(open); }}><Ic d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M16 11h6" size={18} />{L('Convidar')}</button>}
              <button type="button" className="gl-act" onClick={startEdit}><Ic d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" size={18} />{L('Alterar')}</button>
            </div>
          </div>
        </section>
        {list.length > 0 && (() => {
          const out = list.filter((x) => x.type === 'expense'), top = [...out].sort((a, b) => b.amountCents - a.amountCents)[0], sum = out.reduce((a, x) => a + x.amountCents, 0);
          return <div className="gx-tiles">
            <GTile d="M12 19V5M5 12l7-7 7 7" label={L('Maior gasto')} value={top ? money(top.amountCents) : '—'} />
            <GTile d="M4 20V10M10 20V4M16 20v-7M22 20H2" label={L('Média por gasto')} value={out.length ? money(Math.round(sum / out.length)) : '—'} />
            <GTile d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2" label={L('Último movimento')} value={day(list[0].date)} />
            <GTile d={CALENDAR} label={L('Criado a')} value={day(open.createdAt)} />
          </div>;
        })()}
        {list.length === 0 ? <EmptyState icon={EMPTY_IC} title={L('Ainda não há transações')} text={L('Adiciona as despesas deste grupo e vê quanto custa no total.')} examples={['🍽️ '+L('Jantar'), '🏨 '+L('Hotel'), '⛽ '+L('Gasolina'), '🛒 '+L('Compras')]} /> : <section className="mv-card gl-sec">
          <h2>{L('Transações')}</h2>
          {list.map((x) => {
            const c = cats.find((y) => y.id === x.categoryId);
            return <div key={x.id} className="sh-tx"><CatIcon cat={c ?? {}} size={40} /><span className="sh-tx-main"><b>{x.description || (c ? catLabel(t, c) : '—')}</b><small>{day(x.date)}</small></span><b className={x.type === 'income' ? 'fx-pos' : 'fx-neg'}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</b></div>;
          })}
        </section>}
        <div className="gx-end"><button type="button" className="gx-rm" onClick={() => remove(open).catch(() => {})}><Ic d={ICON.trash} size={18} />{L('Apagar grupo')}</button></div>
        </>}
        {sheet}
        {edit && <BottomSheet title={L('Alterar grupo')} onClose={closeEdit}><div className="acc-form">
          {emiss.note ?? (picErr && <FormError text={picErr} />)}
          <label className="gg-photo" style={{ '--g': color } as CSSProperties}>
            <GroupPic key={image || 'icon'} name={name} image={image} big />
            <i aria-hidden="true"><Ic d="M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" size={18} /></i>
            <input type="file" accept="image/*" aria-label={L('Escolher foto')} onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <div className="gg-photo-acts"><span>{image ? L('Toca na foto para a trocar') : L('Toca para escolher uma foto')}</span>{image && <button type="button" onClick={() => setImage('')}>{L('Tirar a foto')}</button>}</div>
          <div className="tx-rows"><TextRow icon={FI.name} label={L('Nome')} value={name} onChange={setName} placeholder={L('Ex.: Férias de verão')} cls={emiss.cls('name')} /></div>
          <div className="gg-colors" role="radiogroup" aria-label={L('Cor')}>{COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
          {info?.owner && <>
            <div className="tx-rows"><SwitchRow icon="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" label={L('Permitir que os outros alterem o grupo')} sub={allow ? L('Escolhe quem pode') : L('Só tu podes alterar')} on={allow} onChange={setAllow} /></div>
            <div className={'acc-exp' + (allow ? ' open' : '')} aria-hidden={!allow} inert={!allow}><div><div className="sp-list gx-crew gx-eds">
              {info.people.length === 0 && <p className="fx-muted">{L('Ainda não há mais ninguém neste grupo.')}</p>}
              {info.people.map((m) => { const on = eds.includes(m.userId); return <div key={m.userId} className="sp-row"><Face m={m} /><span className="sp-row-main"><span className="sp-row-top"><b>{m.displayName}</b></span></span><button type="button" role="switch" aria-checked={on} aria-label={m.displayName} className={'ob-toggle' + (on ? ' on' : '')} onClick={() => setEds(on ? eds.filter((x) => x !== m.userId) : [...eds, m.userId])}><i /></button></div>; })}
            </div></div></div>
          </>}
          <button type="button" className="tx-addbtn" onClick={saveEdit}>{L('Guardar')}</button>
        </div></BottomSheet>}
      </div>
    );
  }

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">{L('Grupos')}</h1></header>
      {groups.length === 0 && <EmptyState icon="M4 6h16M4 12h16M4 18h10" title={L('Ainda não tens grupos')} text={L('Junta despesas de uma coisa só e vê quanto custou no total.')} examples={['✈️ Viagem', '🔨 Obras', '🎄 Natal']} />}
      <div className="gl-grid">
        {groups.map((g, i) => {
          const sid = splitIdOf(g.id), k = sid ? crew[sid] : undefined, c = k && k.members.some((m) => m.userId !== me) || k?.pending ? k : undefined, // só eu: é um grupo normal
             others = (c?.members ?? []).filter((m) => m.userId !== me), n = (c?.members.length ?? 0) + (c?.pending ?? 0);
          const names = others.length === 0 ? '' : others.length <= 2 ? others.map((m) => m.displayName.split(' ')[0]).join(` ${L('e')} `) : `${others[0].displayName.split(' ')[0]}, ${others[1].displayName.split(' ')[0]} +${others.length - 2}`;
          return (
            <Link key={g.id} to={`/grupos/${g.id}`} className="mv-card gl-card gg-card" style={{ '--g': g.color, '--i': i } as CSSProperties}>
              <GroupPic name={g.name} image={g.image} />
              <span className="gl-main">
                <b className="gl-name">{g.name}</b>
                <span className="gl-money"><b>{money(sharedOf(g.id)?.cents ?? total(g.id))}</b> · {count(sharedOf(g.id)?.n ?? of(g.id).length)}</span>
                {sid && c && <span className="gg-crew">
                  <span className="gg-faces">{others.slice(0, 4).map((m) => <Face key={m.userId} m={m} />)}{others.length > 4 && <i>+{others.length - 4}</i>}{c.pending > 0 && <i className="wait" title={L('Pendente')}>⏳</i>}</span>
                  <small>{names ? `${L('Com')} ${names}` : L('À espera de resposta')}</small>
                </span>}
                {sid && c && n > 1 && sharedOf(g.id) && <span className="gl-chips"><em className={c.due ? 'due' : 'ok'}>{c.due ? L('Por pagar') : L('Pago')}</em></span>}
              </span>
              <span className="gl-go"><Ic d={ICON.right} size={18} /></span>
            </Link>
          );
        })}
      </div>
      <button type="button" className="sh-btn in" onClick={() => setAdding('new')}><Ic d={ICON.plus} size={20} />{L('Novo grupo')}</button>
      {sheet}
    </div>
  );
}
