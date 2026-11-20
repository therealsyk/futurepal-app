// Grupos (ex.: "Férias", "Casa nova") — juntar despesas e ver quanto custou cada coisa.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/app-db';
import type { Group, Transaction } from '../db/database';
import { addGroup } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { Ic, ICON } from '../ui/fx';
import { EmptyState } from '../ui/EmptyState';

const COLORS = ['#17c3c9', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#ec4899'];

export function Groups() {
  const navigate = useNavigate();
  const { id } = useParams();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const [groups, setGroups] = useState<Group[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setGroups((await db.groups.toArray()).filter((g) => g.deletedAt === null));
    setTxs((await db.transactions.toArray()).filter((x) => x.deletedAt === null && x.groupId));
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const of = (g: string) => txs.filter((x) => x.groupId === g);
  const total = (g: string) => of(g).reduce((a, x) => a + (x.type === 'expense' ? x.amountCents : -x.amountCents), 0);
  const create = async () => {
    if (!name.trim()) return;
    await addGroup(db, name.trim(), COLORS[groups.length % COLORS.length]);
    setName(''); setAdding(false); await load();
  };
  const remove = async (g: Group) => {
    if (!window.confirm(`Apagar o grupo "${g.name}"? As despesas ficam, só deixam de estar no grupo.`)) return;
    const now = new Date().toISOString();
    await db.groups.update(g.id, { deletedAt: now, updatedAt: now });
    for (const x of of(g.id)) await db.transactions.update(x.id, { groupId: undefined, updatedAt: now });
    navigate('/grupos'); await load();
  };

  const open = groups.find((g) => g.id === id);
  if (open) {
    const list = of(open.id).sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div className="fx-page mv sh">
        <header className="mv-head"><Link to="/grupos" className="mv-sq" aria-label="Voltar"><Ic d={ICON.left} size={20} /></Link><h1 className="sh-title">{open.name}</h1></header>
        <section className="mv-hero sh-hero">
          <small className="mv-hero-label">Total gasto neste grupo</small>
          <div className="sh-big">{money(total(open.id))}</div>
          <small className="sh-pct">{list.length} {list.length === 1 ? 'movimento' : 'movimentos'}</small>
        </section>
        <Link to={`/transacoes?nova=1&grupo=${open.id}`} className="sh-btn in">+ Adicionar despesa a este grupo</Link>
        <section className="mv-card">
          <div className="mv-card-head"><h2>Movimentos</h2></div>
          {list.length === 0 ? <p className="fx-muted">Ainda não há despesas neste grupo.</p> : list.map((x) => (
            <div key={x.id} className="sh-tx"><span className="sh-tx-main"><b>{x.description || '—'}</b><small>{x.date.split('-').reverse().join('/')}</small></span><b>{money(x.amountCents)}</b></div>
          ))}
        </section>
        <button type="button" className="sh-danger" onClick={() => remove(open)}>Apagar grupo</button>
      </div>
    );
  }

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">Grupos</h1></header>
      <p className="fx-muted" style={{ margin: 0 }}>Junta despesas de uma coisa só (ex.: férias, obras, Natal) e vê quanto custou no total.</p>
      {groups.length === 0 && !adding && <EmptyState icon="M4 6h16M4 12h16M4 18h10" title="Ainda não tens grupos" text="Junta despesas de uma coisa só e vê quanto custou no total." examples={['✈️ Viagem', '🔨 Obras', '🎄 Natal']} />}
      <div className="sh-groups-grid">
        {groups.map((g) => (
          <Link key={g.id} to={`/grupos/${g.id}`} className="sh-group" style={{ ['--g' as string]: g.color }}>
            <b>{g.name}</b><span>{money(total(g.id))}</span><small>{of(g.id).length} movimentos</small>
          </Link>
        ))}
        {adding ? (
          <div className="sh-group new">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Férias de verão" onKeyDown={(e) => e.key === 'Enter' && create()} />
            <button type="button" className="sh-btn in sm" onClick={create} disabled={!name.trim()}>Criar</button>
          </div>
        ) : (
          <button type="button" className="sh-group new" onClick={() => setAdding(true)}><Ic d={ICON.plus} size={22} /><b>Novo grupo</b></button>
        )}
      </div>
    </div>
  );
}
