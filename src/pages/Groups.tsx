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
import { linkedGroupId, splitIdOf } from '../core/groupLink';
import { CatIcon, Ic, ICON } from '../ui/fx';
import { EmptyState } from '../ui/EmptyState';
import { FI, TextRow } from '../ui/formFields';
import { useMissing } from '../ui/missing';
import { IS_DEMO } from '../demo/demo';
import { BottomSheet } from './SimplePages';
import { SplitPage } from './Split';
import { L } from '../i18n/phrases';

const COLORS = ['#17c3c9', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#ec4899'];

export function Groups() {
  const navigate = useNavigate();
  const auth = useAuth();
  const me = auth.user?.id ?? '';
  const { id } = useParams();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const day = (iso: string) => new Date(iso).toLocaleDateString(s.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const [groups, setGroups] = useState<Group[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const missing = useMissing();
  const miss = missing([['name', L('o nome'), !!name.trim()]]);

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
    (async () => {
      const { data } = await sb.from('split_groups').select('id, name, created_at');
      const have = new Set((await db.groups.toArray()).map((g) => g.id)); // inclui os apagados: não voltam
      let n = have.size;
      for (const g of (data ?? []) as Array<{ id: string; name: string; created_at: string }>) {
        const gid = linkedGroupId(g.id, me);
        if (!have.has(gid)) await db.groups.put({ id: gid, name: g.name, color: COLORS[n++ % COLORS.length], createdAt: g.created_at, updatedAt: new Date().toISOString(), deletedAt: null });
      }
      await load();
    })().catch(() => {});
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const of = (g: string) => txs.filter((x) => x.groupId === g);
  const total = (g: string) => of(g).reduce((a, x) => a + (x.type === 'expense' ? x.amountCents : -x.amountCents), 0);
  const count = (n: number) => `${n} ${n === 1 ? L('movimento') : L('movimentos')}`;
  const close = () => { setAdding(false); setName(''); miss.reset(); };
  const create = async () => {
    if (!miss.check()) return;
    const g = await addGroup(db, name.trim(), COLORS[groups.length % COLORS.length]);
    close(); await load(); navigate(`/grupos/${g.id}`);
  };
  const remove = async (g: Group) => {
    const split = splitIdOf(g.id);
    if (!await appConfirm(`${L('Apagar grupo')} "${g.name}"? ${L('As despesas ficam, só deixam de estar no grupo.')}${split ? ' ' + L('Também sais da divisão de contas deste grupo.') : ''}`)) return;
    if (split) { const r = await getSupabase()?.rpc('leave_split_group', { p_group: split }); if (r?.error) { await appConfirm(r.error.message, { ok: 'OK' }); return; } }
    const now = new Date().toISOString();
    await db.groups.update(g.id, { deletedAt: now, updatedAt: now });
    for (const x of of(g.id)) await db.transactions.update(x.id, { groupId: undefined, updatedAt: now });
    navigate('/grupos'); await load();
  };
  // o grupo passa a ser dividido: muda de id (para ficar ligado) e leva as suas transações
  const link = async (g: Group, splitId: string) => {
    const now = new Date().toISOString(), gid = linkedGroupId(splitId, me);
    await db.transaction('rw', [db.groups, db.transactions, db.recurrings], async () => {
      await db.groups.put({ ...g, id: gid, updatedAt: now });
      for (const x of await db.transactions.toArray()) if (x.groupId === g.id) await db.transactions.update(x.id, { groupId: gid, updatedAt: now });
      if (gid !== g.id) await db.groups.update(g.id, { deletedAt: now, updatedAt: now });
    });
    await load(); navigate(`/grupos/${gid}`, { replace: true });
  };

  const open = groups.find((g) => g.id === id);
  if (open) {
    const list = of(open.id).sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div className="fx-page mv sh grp">
        <header className="mv-head"><Link to="/grupos" className="mv-sq" aria-label={L('Voltar')}><Ic d={ICON.left} size={20} /></Link><h1 className="sh-title">{open.name}</h1></header>
        <section className="mv-hero sh-hero grp-total">
          <small className="mv-hero-label">{L('Total')}</small>
          <div className="sh-big">{money(total(open.id))}</div>
          <div className="sh-row"><small className="sh-pct">{L('Criado a')} {day(open.createdAt)}</small><small className="sh-pct">{count(list.length)}</small></div>
        </section>
        <section className="mv-card">
          <div className="mv-card-head"><h2>{L('Transações')}</h2><Link to={`/transacoes?nova=1&grupo=${open.id}`} className="sh-btn in sm grp-add"><Ic d={ICON.plus} size={16} />{L('Adicionar transação')}</Link></div>
          {list.length === 0 ? <p className="fx-muted">{L('Adiciona transações a este grupo para veres quanto custa no total.')}</p> : list.map((x) => {
            const c = cats.find((y) => y.id === x.categoryId);
            return <div key={x.id} className="sh-tx"><CatIcon cat={c ?? {}} size={36} /><span className="sh-tx-main"><b>{x.description || '—'}</b><small>{day(x.date)}</small></span><b className={x.type === 'income' ? 'fx-pos' : ''}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</b></div>;
          })}
        </section>
        {!IS_DEMO && <section className="grp-split">
          <h2>{L('Dividir com outras pessoas')}</h2>
          <SplitPage key={open.id} embed={{ splitId: splitIdOf(open.id), name: open.name, groupId: open.id, onLinked: (sid) => link(open, sid), onAdded: () => { load().catch(() => {}); } }} />
        </section>}
        <button type="button" className="sh-danger" onClick={() => remove(open)}>{L('Apagar grupo')}</button>
      </div>
    );
  }

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">{L('Grupos')}</h1></header>
      <p className="fx-muted" style={{ margin: 0 }}>{L('Junta as transações de uma coisa só (férias, obras, jantares), vê o total e divide com quem quiseres.')}</p>
      {!IS_DEMO && <SplitPage embed={{ splitId: null, name: '', groupId: '', invitesOnly: true, onLinked: async () => {}, onAdded: () => { load().catch(() => {}); } }} />}
      {groups.length === 0 && <EmptyState icon="M4 6h16M4 12h16M4 18h10" title={L('Ainda não tens grupos')} text={L('Junta despesas de uma coisa só e vê quanto custou no total.')} examples={['✈️ Viagem', '🔨 Obras', '🎄 Natal']} />}
      <div className="sh-groups-grid">
        {groups.map((g) => (
          <Link key={g.id} to={`/grupos/${g.id}`} className="sh-group" style={{ ['--g' as string]: g.color }}>
            <b>{g.name}</b><span>{money(total(g.id))}</span><small>{count(of(g.id).length)}{splitIdOf(g.id) ? ` · ${L('Dividido')}` : ''}</small>
          </Link>
        ))}
      </div>
      <button type="button" className="sh-btn in" onClick={() => setAdding(true)}><Ic d={ICON.plus} size={20} />{L('Novo grupo')}</button>
      {adding && <BottomSheet title={L('Novo grupo')} onClose={close}>
        <div className="acc-form">
          {miss.note}
          <div className="tx-rows"><TextRow icon={FI.name} label={L('Nome')} value={name} onChange={setName} placeholder={L('Ex.: Férias de verão')} cls={miss.cls('name')} /></div>
          <button type="button" className="tx-addbtn" onClick={create}>{L('Criar grupo')}</button>
        </div>
      </BottomSheet>}
    </div>
  );
}
