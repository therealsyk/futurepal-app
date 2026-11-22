// Contas e Limites, organizados como no vídeo de referência, no estilo FuturePal.
import { useMissing } from '../ui/missing';
import { useEffect, useState } from 'react';
import { appConfirm } from '../ui/confirm';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Budget, Category, Goal, Salary, Transaction, Transfer } from '../db/database';
import { accountBalanceCents, addAccount, removeAccount, updateAccount } from '../core/accounts';
import { addGoal, contributeToGoal, setBudget } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { forecastGoal, type GoalForecast } from '../core/goalForecast';
import { Ic, ICON, CatIcon, catLabel, CategorySelect } from '../ui/fx';
import { EmptyState } from '../ui/EmptyState';
import { L } from '../i18n/phrases';
import { DatePicker } from '../ui/DatePicker';

// Folha que sobe do fundo do ecrã (resto desfocado). Voltar, tocar fora ou Esc fecham.
export function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <div className="bs-backdrop" onClick={onClose}>
      <div className="bs-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="bs-grab" aria-hidden="true" />
        <header className="bs-head"><button type="button" className="bs-back" onClick={onClose}><Ic d={ICON.left} size={18} />{L('Voltar')}</button><h2>{title}</h2><span /></header>
        <div className="bs-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

type Data = { txs: Transaction[]; cats: Category[]; accounts: Account[]; transfers: Transfer[]; salaries: Salary[]; budgets: Budget[] };
const live = <T extends { deletedAt: string | null }>(a: T[]) => a.filter((x) => x.deletedAt === null);
async function loadAll(): Promise<Data> {
  return {
    txs: live(await db.transactions.toArray()), cats: live(await db.categories.toArray()), accounts: live(await db.accounts.toArray()),
    transfers: live(await db.transfers.toArray()), salaries: live(await db.salaries.toArray()), budgets: live(await db.budgets.toArray()),
  };
}
const useMoney = () => { const s = loadSettings(); return (c: number) => formatMoney(c, s.currency, s.language); };

// ── Contas: total no topo, separadores Gastos / Poupança / Dívidas, um cartão por conta
const TYPES = [{ id: 'spending', label: L('Gastos') }, { id: 'savings', label: L('Poupança') }, { id: 'debt', label: L('Dívidas') }] as const;
const TYPE_IC: Record<string, string> = { spending: ICON.wallet, savings: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2z', debt: 'M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5' };

export function SimpleAccounts() {
  const money = useMoney();
  const s = loadSettings();
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState<'spending' | 'savings' | 'debt'>('spending');
  const [form, setForm] = useState(false);
  const [name, setName] = useState('');
  const [bal, setBal] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const missing = useMissing();
  const [eBal, setEBal] = useState('');
  const reload = () => loadAll().then(setD).catch(() => {});
  useEffect(() => { reload(); }, []);

  const now = new Date();
  const salaryToDate = (d?.salaries ?? []).filter((x) => x.year * 100 + x.month <= now.getFullYear() * 100 + now.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
  const balOf = (a: Account) => (d ? accountBalanceCents(a, d.txs, d.accounts, salaryToDate, d.transfers) : 0);
  // Mesma conta que o Início: dinheiro nas contas (sem dívidas) e, à parte, quanto se deve
  const money_ = (d?.accounts ?? []).filter((a) => a.type !== 'debt').reduce((sum, a) => sum + balOf(a), 0);
  const debts = (d?.accounts ?? []).filter((a) => a.type === 'debt').reduce((sum, a) => sum + balOf(a), 0);
  const openEdit = (a: Account) => { setEdit(edit === a.id ? null : a.id); setEName(a.name); setEBal((balOf(a) / 100).toFixed(2).replace('.', ',')); };
  const saveEdit = async (a: Account) => {
    const v = parseMoneyToCents(eBal || '0') ?? 0;
    await updateAccount(db, a.id, { name: eName.trim() || a.name, initialBalanceCents: a.initialBalanceCents + (v - balOf(a)) });
    setEdit(null); reload();
  };
  const delAcc = async (a: Account) => { if (await appConfirm(`${L('Apagar conta')} "${a.name}"?`)) { await removeAccount(db, a.id); setEdit(null); reload(); } };
  const list = (d?.accounts ?? []).filter((a) => a.type === tab).sort((a, b) => a.order - b.order);
  const miss = missing([['name', L('o nome'), !!name.trim()]]);
  const closeForm = () => { setForm(false); miss.reset(); };
  const create = async () => {
    if (!miss.check()) return;
    await addAccount(db, { name: name.trim(), description: '', type: tab, currency: s.currency, initialBalanceCents: Math.abs(parseMoneyToCents(bal || '0') ?? 0), includeInNetWorth: true, isDefault: false, showOnHome: true });
    setName(''); setBal(''); setForm(false); reload();
  };

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">{L('Contas')}</h1></header>
      <div className="sh-kpis">
        <div className="sh-kpi"><small>{L('Dinheiro nas contas')}</small><b className={money_ < 0 ? 'fx-neg' : 'fx-pos'}>{money(money_)}</b></div>
        <div className="sh-kpi"><small>{L('Dívidas')}</small><b className={debts > 0 ? 'fx-neg' : ''}>{money(debts)}</b></div>
      </div>
      <div className="sh-seg" role="tablist">
        {TYPES.map((x) => <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => { setTab(x.id); setForm(false); }}>{x.label}</button>)}
      </div>
      {tab === 'debt' && <p className="sh-info">{L('Para baixar uma dívida, faz uma transferência de uma conta de gastos ou de poupança para a conta da dívida.')}</p>}
      {list.length === 0 && <EmptyState icon="M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16 14.5h.01" title={tab === 'debt' ? L('Sem dívidas registadas') : tab === 'savings' ? L('Sem contas de poupança') : L('Sem contas de gastos')} text={tab === 'debt' ? L('Regista um empréstimo para acompanhares quanto ainda falta pagar.') : L('Cria uma conta para veres o teu saldo sempre atualizado.')} examples={tab === 'debt' ? ['🏠 Crédito habitação', '🚗 Crédito auto'] : tab === 'savings' ? ['🐷 Poupanças', '🛟 Fundo de emergência'] : ['🏦 Conta do banco', '💶 Dinheiro']} />}
      {list.map((a) => (
        <div key={a.id} className="sh-accwrap">
          <button type="button" className={'acc-card sh-acc t-' + a.type} onClick={() => openEdit(a)} aria-expanded={edit === a.id}>
            <div className="acc-card-top"><span className="acc-card-ic"><Ic d={TYPE_IC[a.type]} size={16} /></span><b>{a.name}</b>{a.isDefault && <small>{L('Principal')}</small>}</div>
            <div className={'acc-card-val' + (balOf(a) < 0 ? ' neg' : '')}>{money(balOf(a))}</div>
          </button>
          {edit === a.id && (
            <section className="mv-card sh-form">
              <label>{L('Nome')}<input value={eName} onChange={(e) => setEName(e.target.value)} /></label>
              <label>{a.type === 'debt' ? L('Quanto deves agora') : L('Quanto tem agora')}<input inputMode="decimal" value={eBal} onChange={(e) => setEBal(e.target.value)} /></label>
              <button type="button" className="sh-btn in sm" onClick={() => saveEdit(a)}>{L('Guardar')}</button>
              {!a.isDefault && <button type="button" className="sh-danger" onClick={() => delAcc(a)}>{L('Apagar conta')}</button>}
            </section>
          )}
        </div>
      ))}
<button type="button" className="sh-btn in" onClick={() => setForm(true)}><Ic d={ICON.plus} size={20} />{L('Criar conta')}</button>
      {form && <BottomSheet title={L('Nova conta')} onClose={closeForm}>
        {miss.note}
        <section className="mv-card sh-form">
          <label className={miss.cls('name')}>{L('Nome da conta')}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tab === 'debt' ? L('Ex.: Empréstimo da casa') : tab === 'savings' ? L('Ex.: Poupanças') : L('Ex.: Conta do banco')} /></label>
          <label className="bs-amount"><small>{tab === 'debt' ? L('Quanto deves') : L('Quanto tem agora')}</small><input className="tx-amt" inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" /><span className="tx-cur">{loadSettings().currency}</span></label>
          <button type="button" className="sh-btn in sm" onClick={create}>{L('Criar conta')}</button>
        </section>
      
      </BottomSheet>}
    </div>
  );
}

// ── Limites do mês: resumo (recebido, gasto, sobra) e um círculo por categoria com "quanto sobra"
export function SimpleLimits() {
  const { t } = useTranslation();
  const money = useMoney();
  const s = loadSettings();
  const [d, setD] = useState<Data | null>(null);
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [form, setForm] = useState(false);
  const [edit, setEdit] = useState<Budget | null>(null);
  const [editAmt, setEditAmt] = useState('');
  const [delConfirm, setDelConfirm] = useState(false);
  const missing = useMissing();
  const missingEdit = useMissing();
  const [cat, setCat] = useState('');
  const [amt, setAmt] = useState('');
  const [hasEnd, setHasEnd] = useState(false);
  const [endM, setEndM] = useState(''); // AAAA-MM
  const reload = () => loadAll().then(setD).catch(() => {});
  useEffect(() => { reload(); }, []);

  const shift = (k: number) => setCur((c) => ({ y: c.y + Math.floor((c.m + k) / 12), m: ((c.m + k) % 12 + 12) % 12 }));
  const prefix = `${cur.y}-${String(cur.m + 1).padStart(2, '0')}`;
  const month = (d?.txs ?? []).filter((x) => x.date.startsWith(prefix));
  const limits = (d?.budgets ?? []).filter((b) => b.year === cur.y && b.month === cur.m + 1);
  const catOf = (id: string) => d?.cats.find((c) => c.id === id);
  const spentIn = (id: string) => month.filter((x) => x.type === 'expense' && x.categoryId === id).reduce((a, x) => a + x.amountCents, 0);
  const expenseCats = (d?.cats ?? []).filter((c) => c.group !== 'income' && !limits.some((b) => b.categoryId === c.id));
  const miss = missing([['amount', L('o valor'), (parseMoneyToCents(amt) ?? 0) > 0], ['cat', L('a categoria'), !!cat], ['end', L('a data limite'), !hasEnd || !!endM]]);
  const missEdit = missingEdit([['amount', L('o valor'), (parseMoneyToCents(editAmt) ?? 0) > 0]]);
  const closeForm = () => { setForm(false); miss.reset(); };
  const create = async () => {
    const cents = parseMoneyToCents(amt);
    if (!miss.check() || !cents) return;
    // com data limite: o mesmo limite em todos os meses até lá; sem data: só este mês
    let y = cur.y, mo = cur.m + 1;
    const [ey, em] = hasEnd && endM ? endM.split('-').map(Number) : [y, mo];
    while (y * 100 + mo <= ey * 100 + em) { await setBudget(db, cat, Math.abs(cents), y, mo); mo++; if (mo > 12) { mo = 1; y++; } }
    setHasEnd(false); setEndM('');
    setCat(''); setAmt(''); setForm(false); reload();
  };
  const label = new Date(cur.y, cur.m, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' });

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">{L('Limites do mês')}</h1><Link to="/orcamentos-completo" className="mv-sq" aria-label={L('Mais opções')}><Ic d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" size={18} /></Link></header>
      <section className="mv-hero sh-hero">
        <div className="mv-hero-top">
          <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={L('Mês anterior')}><Ic d={ICON.left} size={18} /></button>
          <span className="mv-month">{label}</span>
          <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={L('Mês seguinte')}><Ic d={ICON.right} size={18} /></button>
        </div>
        {limits.length === 0 ? <p className="lim-empty">{L('Ainda não tens limites este mês.')}</p> : (() => {
          // tudo num só número, em linguagem simples: quanto ainda posso gastar dentro dos meus limites
          const total = limits.reduce((a2, b) => a2 + b.limitCents, 0);
          const used = limits.reduce((a2, b) => a2 + spentIn(b.categoryId), 0);
          const left = total - used, r = total > 0 ? Math.min(1, used / total) : 0;
          return (<>
            <small className="mv-hero-label">{left >= 0 ? L('Ainda podes gastar') : L('Passaste os limites em')}</small>
            <div className="sh-valrow"><span className={'sh-big ' + (left >= 0 ? 'fx-pos' : 'fx-neg')}>{money(Math.abs(left))}</span></div>
            <div className={'sh-bar' + (left < 0 ? ' over' : r > 0.85 ? ' warn' : '')} aria-hidden="true"><i style={{ width: `${r * 100}%` }} /></div>
            <p className="lim-line">{L('Já gastaste')} <b>{money(used)}</b> {L('dos')} <b>{money(total)}</b> {L('que planeaste para este mês.')}</p>
          </>);
        })()}
      </section>

      <section className="mv-card">
        <div className="mv-card-head"><h2>{L('Por categoria')}</h2></div>
        {limits.length === 0 && <EmptyState icon="M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z" title={L('Sem limites este mês')} text={L('Define quanto queres gastar no máximo numa categoria. A app avisa quando estiveres perto.')} examples={['🛒 Supermercado', '⛽ Combustível', '🍽️ Restaurantes']} />}
        <div className="sh-limits">
          {limits.map((b) => {
            const c = catOf(b.categoryId), used = spentIn(b.categoryId), r = b.limitCents > 0 ? used / b.limitCents : 0, left = b.limitCents - used;
            return (
              <button type="button" key={b.id} className={'sh-limit' + (r > 1 ? ' over' : r > 0.85 ? ' warn' : '')} style={{ ['--p' as string]: Math.min(1, r) }}
                onClick={() => { setEdit(b); setEditAmt((b.limitCents / 100).toFixed(2).replace('.', ',')); }} aria-label={`${L('Alterar limite')}: ${c ? catLabel(t, c) : ''}`}>
                <span className="sh-ring"><CatIcon cat={c ?? {}} size={44} /></span>
                <b>{c ? catLabel(t, c) : '—'}</b>
                <small className={left < 0 ? 'fx-neg' : ''}>{left >= 0 ? `${L('Podes gastar')} ${money(left)}` : `${L('Passaste')} ${money(-left)}`}</small>
                <em className="lim-of">{money(used)} / {money(b.limitCents)}</em>
              </button>
            );
          })}
        </div>
<button type="button" className="sh-btn out sm" onClick={() => setForm(true)}><Ic d={ICON.plus} size={18} />{L('Novo limite')}</button>
      {edit && (() => { const c = catOf(edit.categoryId); return (
        <BottomSheet title={L('Alterar limite')} onClose={() => { setEdit(null); setDelConfirm(false); missEdit.reset(); }}>
          {missEdit.note}
          <div className="sh-form">
            <div className="lim-editcat"><CatIcon cat={c ?? {}} size={40} /><b>{c ? catLabel(t, c) : '—'}</b></div>
            <label className={'bs-amount' + missEdit.cls('amount')}><small>{L('Máximo por mês')}</small><input className="tx-amt" inputMode="decimal" value={editAmt} onChange={(e) => setEditAmt(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" /><span className="tx-cur">{loadSettings().currency}</span></label>
            <button type="button" className="sh-btn in sm" onClick={async () => { const cents = parseMoneyToCents(editAmt); if (!missEdit.check() || !cents) return; await setBudget(db, edit.categoryId, Math.abs(cents), edit.year, edit.month); setEdit(null); reload(); }}>{L('Guardar')}</button>
            <button type="button" className="sh-danger" onClick={async () => {
              // 1.º toque pede confirmação no próprio botão (sem janelas do sistema); 2.º apaga todos os registos deste limite neste mês
              if (!delConfirm) { setDelConfirm(true); return; }
              const t2 = new Date().toISOString();
              const same = (await db.budgets.toArray()).filter((x) => x.deletedAt === null && x.categoryId === edit.categoryId && x.year === edit.year && x.month === edit.month);
              for (const x of same) await db.budgets.update(x.id, { deletedAt: t2, updatedAt: t2 });
              setDelConfirm(false); setEdit(null); reload();
            }}>{delConfirm ? L('Toca outra vez para apagar') : L('Apagar limite')}</button>
          </div>
        </BottomSheet>); })()}
      {form && <BottomSheet title={L('Novo limite')} onClose={closeForm}>
          {miss.note}
          <div className="sh-form">
            <label className={miss.cls('cat')}>{L('Categoria')}<CategorySelect cats={expenseCats} kind="expense" value={cat} onChange={setCat} ariaLabel={L('Categoria')} emptyLabel={L('Escolher…')} className="fx-input tx-val" /></label>
            <label className={'bs-amount' + miss.cls('amount')}><small>{L('Máximo por mês')}</small><input className="tx-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" /><span className="tx-cur">{loadSettings().currency}</span></label>
            <label className="sh-toggle"><span><b>{L('Tem data limite?')}</b><small>{L('Se não ativares, fica só para este mês')}</small></span><input type="checkbox" checked={hasEnd} onChange={(e) => setHasEnd(e.target.checked)} /></label>
            {hasEnd && <label className={miss.cls('end')}>{L('Até ao mês')}<DatePicker value={endM ? endM + '-01' : ''} onChange={(v) => setEndM(v.slice(0, 7))} className="fx-input tx-val" /></label>}
            <button type="button" className="sh-btn in sm" onClick={create}>{L('Guardar limite')}</button>
          </div>
        
      </BottomSheet>}
      </section>
    </div>
  );
}

// ── Metas (como no vídeo): lista de cartões; tocar abre o detalhe; "Criar meta" com valor, notas e contas que contam
export function SimpleGoals() {
  const money = useMoney();
  const s = loadSettings();
  const [d, setD] = useState<(Data & { goals: Goal[] }) | null>(null);
  const missing = useMissing();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [notes, setNotes] = useState('');
  const [accs, setAccs] = useState<string[]>([]);
  const [add, setAdd] = useState('');
  const [hasDeadline, setHasDeadline] = useState(false);
  const [how, setHow] = useState<'hand' | 'accounts'>('hand');
  const [deadline, setDeadline] = useState('');
  const reload = async () => setD({ ...(await loadAll()), goals: live(await db.goals.toArray()) });
  useEffect(() => { reload().catch(() => {}); }, []);

  const now = new Date();
  const salaryToDate = (d?.salaries ?? []).filter((x) => x.year * 100 + x.month <= now.getFullYear() * 100 + now.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
  const balOf = (a: Account) => (d ? accountBalanceCents(a, d.txs, d.accounts, salaryToDate, d.transfers) : 0);
  const currentOf = (g: Goal) => (g.accountIds?.length ? (d?.accounts ?? []).filter((a) => g.accountIds!.includes(a.id)).reduce((x, a) => x + balOf(a), 0) : g.currentCents);
  // Quanto entrou na meta em cada um dos últimos 8 meses (o último é o mês atual)
  const monthlyIn = (g: Goal): number[] => {
    const keys = Array.from({ length: 8 }, (_, i) => { const dt = new Date(now.getFullYear(), now.getMonth() - 7 + i, 1); return { y: dt.getFullYear(), m: dt.getMonth() + 1 }; });
    const ym = (k: { y: number; m: number }) => `${k.y}-${String(k.m).padStart(2, '0')}`;
    if (g.accountIds?.length && d) {
      // conta(s) ligadas: o que mudou no saldo de mês para mês
      const endBal = (k: { y: number; m: number }) => {
        const last = new Date(k.y, k.m, 0).toISOString().slice(0, 10);
        const sal = d.salaries.filter((x) => x.year * 100 + x.month <= k.y * 100 + k.m).reduce((a, x) => a + x.amountCents, 0);
        return d.accounts.filter((a) => g.accountIds!.includes(a.id)).reduce((sum, a) => sum + accountBalanceCents(a, d.txs.filter((t) => t.date <= last), d.accounts, sal, d.transfers.filter((t) => t.date <= last)), 0);
      };
      const prev = new Date(now.getFullYear(), now.getMonth() - 8, 1);
      const bals = [endBal({ y: prev.getFullYear(), m: prev.getMonth() + 1 }), ...keys.map(endBal)];
      return keys.map((_, i) => bals[i + 1] - bals[i]);
    }
    if (g.contributions?.length) return keys.map((k) => g.contributions!.filter((c) => c.date.startsWith(ym(k))).reduce((a, c) => a + c.cents, 0));
    // metas antigas sem histórico: reparte o que já tem pelos meses desde o início
    const since = Math.max(1, (now.getFullYear() - +g.startDate.slice(0, 4)) * 12 + now.getMonth() + 1 - +g.startDate.slice(5, 7));
    return keys.map((_, i) => (i >= 8 - Math.min(8, since + 1) && i < 7 ? Math.round(g.currentCents / since) : 0));
  };
  const dayRatio = now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const fc = (g: Goal, cur: number): GoalForecast => forecastGoal(monthlyIn(g), Math.max(0, g.targetCents - cur), dayRatio);
  const etaLabel = (f: GoalForecast) => f.etaMonths === null ? '' : new Date(now.getFullYear(), now.getMonth() + f.etaMonths, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' });
  // Quanto sobra por mês, em média, nos últimos 3 meses (rendimento − gastos)
  const surplus = (() => {
    const ks = [1, 2, 3].map((k) => { const dt = new Date(now.getFullYear(), now.getMonth() - k, 1); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; });
    const v = ks.map((k) => (d?.txs ?? []).filter((x) => x.date.startsWith(k)).reduce((a, x) => a + (x.type === 'income' ? x.amountCents : -x.amountCents), 0));
    return Math.round(v.reduce((a, b) => a + b, 0) / 3);
  })();
  // Aviso de prazo: com data limite, compara o ritmo atual (e o que costuma sobrar) com o que é preciso por mês
  const deadlineInfo = (g: Goal, cur: number) => {
    if (!g.targetDate) return null;
    const left = Math.max(0, g.targetCents - cur);
    if (left === 0) return null;
    const end = new Date(g.targetDate);
    const monthsLeft = Math.max(1, (end.getFullYear() - now.getFullYear()) * 12 + end.getMonth() - now.getMonth());
    const need = Math.ceil(left / monthsLeft);
    const f = fc(g, cur);
    const late = f.etaMonths === null || f.etaMonths > monthsLeft;
    const tight = surplus < need;
    const until = end.toLocaleDateString(s.language, { day: 'numeric', month: 'long', year: 'numeric' });
    if (!late) return { ok: true, short: `No bom caminho para ${until}`, long: `Estás no bom caminho: a este ritmo chegas antes de ${until}.` };
    return { ok: false, short: `⚠ A este ritmo não chegas até ${until}`,
      long: `A este ritmo não chegas até ${until}. Precisas de juntar cerca de ${money(need)} por mês.` + (tight ? ` Com os teus gastos atuais sobram-te cerca de ${money(Math.max(0, surplus))} por mês, por isso terias de gastar menos ou adiar a data.` : ` Pelo que te costuma sobrar (${money(surplus)}/mês), consegues, se juntares mais à meta.`) };
  };
  const forecast = (g: Goal, cur: number) => {
    const f = fc(g, cur);
    if (f.etaMonths === 0) return 'Objetivo atingido 🎉';
    if (f.etaMonths === null) return 'Previsão: ainda sem dados suficientes';
    const arrow = f.trend === 'up' ? ' ↑' : f.trend === 'down' ? ' ↓' : '';
    return `Previsão: ${etaLabel(f)} (≈ ${money(f.perMonthCents)}/mês${arrow})`;
  };
  const forecastLong = (g: Goal, cur: number) => {
    const f = fc(g, cur);
    if (f.etaMonths === 0) return 'Parabéns, chegaste ao objetivo! 🎉';
    if (f.etaMonths === null) return 'Ainda não há dados suficientes. Junta dinheiro durante um ou dois meses e a previsão aparece aqui.';
    const when = `chegas lá em ${etaLabel(f)} (daqui a ${f.etaMonths} ${f.etaMonths === 1 ? 'mês' : 'meses'})`;
    if (f.trend === 'up') return `Estás a juntar mais do que antes: cerca de ${money(f.perMonthCents)} por mês (antes eram ${money(f.usualCents)}). A previsão adiantou: ${when}.`;
    if (f.trend === 'down') return `Nos últimos meses juntaste menos: cerca de ${money(f.perMonthCents)} por mês (antes eram ${money(f.usualCents)}). A este ritmo, ${when}.`;
    return `Costumas juntar cerca de ${money(f.perMonthCents)} por mês. A este ritmo, ${when}.`;
  };
  const date = (iso: string) => new Date(iso).toLocaleDateString(s.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const miss = missing([['amount', L('o valor'), (parseMoneyToCents(target) ?? 0) > 0], ['name', L('o nome'), !!name.trim()], ['end', L('a data limite'), !hasDeadline || !!deadline], ['accs', L('as contas'), how !== 'accounts' || accs.length > 0]]);
  const closeForm = () => { setForm(false); miss.reset(); };
  const create = async () => {
    const cents = parseMoneyToCents(target);
    if (!miss.check() || !cents) return;
    const g = await addGoal(db, name.trim(), Math.abs(cents), now.toISOString().slice(0, 10), hasDeadline && deadline ? deadline : null);
    await db.goals.update(g.id, { notes: notes.trim() || undefined, accountIds: accs.length ? accs : undefined });
    setName(''); setTarget(''); setNotes(''); setAccs([]); setHasDeadline(false); setDeadline(''); setHow('hand'); setForm(false); reload();
  };

  const g = d?.goals.find((x) => x.id === open);
  if (g) {
    const cur = currentOf(g), r = g.targetCents > 0 ? Math.max(0, Math.min(1, cur / g.targetCents)) : 0;
    const left = Math.max(0, g.targetCents - cur);
    return (
      <div className="fx-page mv sh">
        <header className="mv-head"><button type="button" className="mv-sq" onClick={() => setOpen(null)} aria-label={L('Voltar')}><Ic d={ICON.left} size={20} /></button><h1 className="sh-title">{g.name}</h1></header>
        <section className="mv-hero sh-hero">
          <div className="sh-two">
            <span><small>{L('Já tens')}</small><b className={cur < 0 ? 'fx-neg' : 'fx-pos'}>{money(cur)}</b></span>
            <span><small>{L('Falta')}</small><b>{money(left)}</b></span>
          </div>
          <div className="sh-row"><small className="sh-pct">{L('Objetivo')}: {money(g.targetCents)}</small><b>{Math.round(r * 100)}%</b></div>
          <div className="sh-bar"><i style={{ width: `${r * 100}%` }} /></div>
        </section>
        <section className="mv-card">
          <div className="mv-card-head"><h2>{L('Previsão')}</h2></div>
          <p className="fx-muted" style={{ margin: 0 }}>{forecastLong(g, cur)}</p>
          {(() => { const di = deadlineInfo(g, cur); return di ? <p className={'sh-alert' + (di.ok ? ' ok' : '')}>{di.long}</p> : null; })()}
        </section>
        {g.notes && <section className="mv-card"><div className="mv-card-head"><h2>{L('Notas')}</h2></div><p style={{ margin: 0 }}>{g.notes}</p></section>}
        {!g.accountIds?.length && (
          <section className="mv-card sh-form">
            <label className="bs-amount"><small>{L('Juntar dinheiro a esta meta')}</small><input className="tx-amt" inputMode="decimal" value={add} onChange={(e) => setAdd(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" /><span className="tx-cur">{loadSettings().currency}</span></label>
            <button type="button" className="sh-btn in sm" disabled={!add} onClick={async () => { const c = parseMoneyToCents(add); if (c) { await contributeToGoal(db, g.id, Math.abs(c)); setAdd(''); reload(); } }}>{L('Juntar')}</button>
          </section>
        )}
        <button type="button" className="sh-danger" onClick={async () => { if (await appConfirm(`${L('Apagar meta')} "${g.name}"?`)) { const t2 = new Date().toISOString(); await db.goals.update(g.id, { deletedAt: t2, updatedAt: t2 }); setOpen(null); reload(); } }}>{L('Apagar meta')}</button>
      </div>
    );
  }

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">{L('Metas')}</h1></header>
      {(d?.goals ?? []).length === 0 && <EmptyState icon="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM12 12h.01" title={L('Ainda não tens metas')} text={L('Uma meta é um objetivo para juntar dinheiro. A app mostra quanto falta e quando lá chegas.')} examples={['🏖️ Férias', '🚗 Carro', '🛟 Emergências', '🏠 Casa']} />}
      {(d?.goals ?? []).map((x) => {
        const cur = currentOf(x), r = x.targetCents > 0 ? Math.max(0, Math.min(1, cur / x.targetCents)) : 0;
        return (
          <button key={x.id} type="button" className="mv-card sh-goalcard" onClick={() => setOpen(x.id)}>
            <div className="sh-row"><b>{x.name}</b><b>{Math.round(r * 100)}%</b></div>
            <div className="sh-row"><span className="sh-pct">{money(cur)} / {money(x.targetCents)}</span></div>
            <div className="sh-bar"><i style={{ width: `${r * 100}%` }} /></div>
            <small className="sh-eta">{forecast(x, cur)}</small>
            {(() => { const di = deadlineInfo(x, cur); return di ? <small className={'sh-deadline ' + (di.ok ? 'fx-pos' : 'fx-neg')}>{di.short}</small> : null; })()}
            <div className="sh-row"><small className="sh-pct">Criada a {date(x.createdAt)}</small><Ic d={ICON.right} size={16} /></div>
          </button>
        );
      })}
<button type="button" className="sh-pill" onClick={() => setForm(true)}><Ic d={ICON.plus} size={16} />{L('Criar meta')}</button>
      {form && <BottomSheet title={L('Nova meta')} onClose={closeForm}>
        {miss.note}
        <section className="mv-card sh-form">
          <label className={miss.cls('name')}>{L('O que queres juntar?')}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={L('Ex.: Férias, carro, emergências')} /></label>
          <label className={'bs-amount' + miss.cls('amount')}><small>{L('Quanto queres juntar')}</small><input className="tx-amt" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" /><span className="tx-cur">{loadSettings().currency}</span></label>
          <label className="sh-toggle"><span><b>{L('Tem data limite?')}</b><small>{L('Ex.: quero ter o dinheiro até ao verão')}</small></span>
            <input type="checkbox" checked={hasDeadline} onChange={(e) => setHasDeadline(e.target.checked)} /></label>
          {hasDeadline && <label className={miss.cls('end')}>{L('Até quando')}<DatePicker value={deadline} onChange={(v) => setDeadline(v)} className="fx-input tx-val" /></label>}
          <label>{L('Notas (opcional)')}<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={L('Ex.: para o verão de 2027')} /></label>
          <div className="sh-accpick"><small>{L('Como queres juntar?')}</small>
            <div className="sh-seg small">
              <button type="button" className={how === 'hand' ? 'on' : ''} onClick={() => { setHow('hand'); setAccs([]); }}>{L('Vou juntando à mão')}</button>
              <button type="button" className={how === 'accounts' ? 'on' : ''} onClick={() => setHow('accounts')}>{L('Usar o saldo de contas')}</button>
            </div>
          </div>
          {how === 'accounts' && (d?.accounts ?? []).filter((a) => a.type !== 'debt').length > 0 && (
            <div className={'sh-accpick' + miss.cls('accs')}>
              <small>{L('Quais contas contam para esta meta?')}</small>
              {(d?.accounts ?? []).filter((a) => a.type !== 'debt').map((a) => (
                <label key={a.id} className="sh-toggle"><span><b>{a.name}</b><small>{money(balOf(a))}</small></span>
                  <input type="checkbox" checked={accs.includes(a.id)} onChange={(e) => setAccs(e.target.checked ? [...accs, a.id] : accs.filter((x) => x !== a.id))} /></label>
              ))}
            </div>
          )}
          <button type="button" className="sh-btn in sm" onClick={create}>{L('Criar meta')}</button>
        </section>
      
      </BottomSheet>}
    </div>
  );
}

// ── Resumo do mês (como o "Overview" do vídeo): mês com setas → Resumo | Categorias →
//    barras dos últimos 6 meses → saldo do mês → Recebido / Gasto → movimentos agrupados por dia
export type OverviewPart = 'chart' | 'totals' | 'lines' | 'cal' | 'cats';
/** embed: mostra só um bloco, com o período escolhido fora (Painel do PC). */
export function SimpleOverview({ yearly = false, embed }: { yearly?: boolean; embed?: { y: number; m: number; part: OverviewPart; range?: { from: string; to: string } } }) {
  const { t } = useTranslation();
  const money = useMoney();
  const s = loadSettings();
  const now = new Date();
  const [d, setD] = useState<Data | null>(null);
  const qYear = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('ano')) || now.getFullYear();
  const [curS, setCur] = useState({ y: yearly ? qYear : now.getFullYear(), m: now.getMonth() });
  const cur = embed ? { y: embed.y, m: embed.m } : curS;
  const [tab, setTab] = useState<'sum' | 'cat'>('sum');
  const navigate = useNavigate();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [tip, setTip] = useState<string | null>(null);
  useEffect(() => { if (!tip) return; const id = setTimeout(() => setTip(null), 2500); const off = () => setTip(null); document.addEventListener('click', off); return () => { clearTimeout(id); document.removeEventListener('click', off); }; }, [tip]);
  useEffect(() => { loadAll().then(setD).catch(() => {}); }, []);

  const shift = (k: number) => setCur((c) => (yearly ? { y: c.y + k, m: c.m } : { y: c.y + Math.floor((c.m + k) / 12), m: ((c.m + k) % 12 + 12) % 12 }));
  const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const sumOf = (pref: string) => {
    const rows = (d?.txs ?? []).filter((x) => x.date.startsWith(pref));
    const inc = rows.filter((x) => x.type === 'income'), exp = rows.filter((x) => x.type === 'expense');
    return { rows, income: inc.reduce((a, x) => a + x.amountCents, 0), salary: inc.filter((x) => x.id.startsWith('sal-')).reduce((a, x) => a + x.amountCents, 0), expense: exp.reduce((a, x) => a + x.amountCents, 0) };
  };
  const pref = yearly ? String(cur.y) : key(cur.y, cur.m);
  const rng = embed?.range;
  const m = rng ? (() => { const rows = (d?.txs ?? []).filter((x) => x.date >= rng.from && x.date <= rng.to); const inc = rows.filter((x) => x.type === 'income'), exp = rows.filter((x) => x.type === 'expense'); return { rows, income: inc.reduce((a, x) => a + x.amountCents, 0), salary: 0, expense: exp.reduce((a, x) => a + x.amountCents, 0) }; })() : sumOf(pref);
  const bal = m.income - m.expense;
  // comparação com o mês (ou ano) anterior, como no Início
  const pm = yearly ? sumOf(String(cur.y - 1)) : sumOf(key(cur.m === 0 ? cur.y - 1 : cur.y, (cur.m + 11) % 12));
  const prevBal = pm.income - pm.expense;
  // nome do período anterior, em palavras ("outubro", "2025")
  const prevName = yearly ? String(cur.y - 1)
    : new Intl.DateTimeFormat(loadSettings().language, { month: 'long' }).format(new Date(cur.m === 0 ? cur.y - 1 : cur.y, (cur.m + 11) % 12, 1));
  // etiqueta com a % ao lado do valor; ao tocar mostra "Em comparação com outubro"
  const cmp = (id: string, now_: number, before: number, upIsGood: boolean) => {
    if (before === 0) return null;
    const pctv = Math.round(((now_ - before) / Math.abs(before)) * 100);
    const tone = pctv === 0 ? 'same' : (pctv > 0) === upIsGood ? 'good' : 'bad';
    const label = `Em comparação com ${prevName}`;
    return (
      <span className="sh-trend-box">
        <button type="button" className={'sh-trend ' + tone} aria-label={`${pctv > 0 ? L('Mais') : pctv < 0 ? L('Menos') : L('Igual')} ${Math.abs(pctv)}%. ${label}`}
          onClick={(e) => { e.stopPropagation(); setTip(tip === id ? null : id); }}>
          {pctv > 0 ? '▲' : pctv < 0 ? '▼' : '●'} {Math.abs(pctv)}%
        </button>
        {tip === id && <span className="sh-tip" role="status">{label}</span>}
      </span>
    );
  };
  const bars = Array.from({ length: yearly ? 12 : 24 }, (_, i) => { const dt = new Date(yearly ? cur.y : cur.y - 1, i, 1); const v = sumOf(key(dt.getFullYear(), dt.getMonth())); return { y: dt.getFullYear(), mo: dt.getMonth(), ...v }; });
  const max = Math.max(1, ...bars.map((b) => Math.max(b.income, b.expense)));
  const label = yearly ? String(cur.y) : new Date(cur.y, cur.m, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' });
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const isNow = cur.y === now.getFullYear() && cur.m === now.getMonth();
  const monthsOfYear = cur.y === now.getFullYear() ? now.getMonth() + 1 : 12;
  const perDay = Math.round(m.expense / (isNow ? now.getDate() : days));
  const perMonth = Math.round(m.expense / monthsOfYear);
  // média do período anterior, para comparar (mês anterior inteiro / ano anterior inteiro)
  const prevDays = new Date(cur.m === 0 ? cur.y - 1 : cur.y, cur.m === 0 ? 12 : cur.m, 0).getDate();
  const prevPerDay = Math.round(pm.expense / prevDays);
  const prevPerMonth = Math.round(pm.expense / 12);
  const catOf = (id: string) => d?.cats.find((c) => c.id === id);
  // movimentos agrupados por dia
  const byDay = new Map<string, Transaction[]>();
  for (const x of [...m.rows].sort((a, b) => b.date.localeCompare(a.date))) { const k = yearly ? x.date.slice(0, 7) : x.date; byDay.set(k, [...(byDay.get(k) ?? []), x]); }
  // categorias
  const catRows = (() => {
    const map = new Map<string, number>();
    for (const x of m.rows.filter((r) => r.type === kind)) map.set(x.categoryId, (map.get(x.categoryId) ?? 0) + x.amountCents);
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return { total, list: [...map.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ id, v, r: total ? v / total : 0, c: catOf(id) })) };
  })();
  const COLS = ['var(--mv)', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#22c55e', '#94a3b8'];
  let acc = 0;
  const donut = catRows.list.map((x, i) => { const from = acc; acc += x.r; return `${COLS[i % COLS.length]} ${from * 360}deg ${acc * 360}deg`; }).join(', ');

  const monthCal = () => {
        // Calendário do mês: gasto de cada dia; cor mais forte = dia com mais despesas; tocar abre as transações desse dia
        const spentDay: Record<number, number> = {};
        for (const x of m.rows) if (x.type === 'expense') { const dd = +x.date.slice(8, 10); spentDay[dd] = (spentDay[dd] ?? 0) + x.amountCents; }
        const top = Math.max(0, ...Object.values(spentDay));
        const lead = (new Date(cur.y, cur.m, 1).getDay() + 6) % 7; // semana começa à segunda
        const best = Object.entries(spentDay).sort((a2, b2) => b2[1] - a2[1])[0];
        const short = (c: number) => (c >= 10000 ? new Intl.NumberFormat(s.language, { style: 'currency', currency: s.currency, maximumFractionDigits: 0 }).format(Math.round(c / 100)) : money(c));
        return (
          <section className="mv-card">
            <div className="mv-card-head"><h2>{t('blk.perDay')}</h2></div>
            <div className="sh-cal">
              {Array.from({ length: 7 }, (_, k) => new Date(2024, 0, 1 + k).toLocaleDateString(s.language, { weekday: 'narrow' })).map((w, k) => <span key={k} className="sh-calh">{w}</span>)}
              {Array.from({ length: lead }, (_, k) => <span key={'e' + k} />)}
              {Array.from({ length: days }, (_, k) => {
                const dd = k + 1, v = spentDay[dd] ?? 0;
                const iso = `${pref}-${String(dd).padStart(2, '0')}`;
                const today = isNow && dd === now.getDate();
                return (
                  <button key={dd} type="button" className={'sh-calday' + (today ? ' today' : '') + (v ? ' has' : '')} style={{ ['--i' as string]: top && v ? 0.15 + 0.6 * (v / top) : 0 }} onClick={() => navigate(`/transacoes?mes=${pref}&dia=${iso}`)} aria-label={`${dd}: ${money(v)}`}>
                    <span>{dd}</span>{v > 0 && <small>{short(v)}</small>}
                  </button>
                );
              })}
            </div>
            {best && <div className="sh-bestcard"><i><Ic d="M12 19V5M5 12l7-7 7 7" size={16} /></i><span><small>{t('blk.biggest')}</small><b>{new Date(cur.y, cur.m, +best[0]).toLocaleDateString(s.language, { day: 'numeric', month: 'long' })}</b></span><strong>{money(best[1])}</strong></div>}
          </section>
        );
  };

  // Ano: 12 quadrados (um por mês) com o total gasto; cor mais forte = mês com mais despesas; tocar abre as transações desse mês
  const yearCal = () => {
    const tot = Array.from({ length: 12 }, (_, k) => (d?.txs ?? []).filter((x) => x.type === 'expense' && x.date.startsWith(key(cur.y, k))).reduce((a2, x) => a2 + x.amountCents, 0));
    const top = Math.max(0, ...tot);
    const bestM = tot.indexOf(top);
    return (
      <section className="mv-card">
        <div className="mv-card-head"><h2>{t('blk.perMonth')}</h2></div>
        <div className="sh-ycal">
          {tot.map((v, k) => (
            <button key={k} type="button" className={'sh-ymonth' + (cur.y === now.getFullYear() && k === now.getMonth() ? ' today' : '')} style={{ ['--i' as string]: top && v ? 0.15 + 0.6 * (v / top) : 0 }} onClick={() => navigate(`/transacoes?mes=${key(cur.y, k)}`)}>
              <span>{new Date(cur.y, k, 1).toLocaleDateString(s.language, { month: 'short' }).replace('.', '')}</span>
              <small>{v ? money(v) : '—'}</small>
            </button>
          ))}
        </div>
        {top > 0 && <div className="sh-bestcard"><i><Ic d="M12 19V5M5 12l7-7 7 7" size={16} /></i><span><small>{t('blk.biggest')}</small><b>{new Date(cur.y, bestM, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' })}</b></span><strong>{money(top)}</strong></div>}
      </section>
    );
  };

  const chartEl = (<>
          <section className="mv-card">
            <div className="sh-bars" aria-label={L('Meses')} ref={(el) => { const all = el ? [...el.querySelectorAll('.sh-barcol.has')] : []; const on = (el?.querySelector('.sh-barcol.on') ?? all[all.length - 1] ?? null) as HTMLElement | null; if (el && on) el.scrollTo({ left: on.offsetLeft - el.clientWidth / 2 + on.clientWidth / 2, behavior: 'smooth' }); }}>
              {bars.map((b) => (
                <button key={b.y + '-' + b.mo} type="button" className={'sh-barcol' + (!yearly && b.y === cur.y && b.mo === cur.m ? ' on' : '') + (b.income || b.expense ? ' has' : '')} onClick={() => setCur({ y: b.y, m: b.mo })} aria-pressed={!yearly && b.y === cur.y && b.mo === cur.m}>
                  <span className="sh-barpair"><i className="inc" style={{ height: `${(b.income / max) * 100}%` }} /><i className="exp" style={{ height: `${(b.expense / max) * 100}%` }} /></span>
                  <small>{new Date(b.y, b.mo, 1).toLocaleDateString(s.language, { month: 'short' }).replace('.', '')}{b.mo === 0 ? ` ${String(b.y).slice(2)}` : ''}</small>
                </button>
              ))}
            </div>
            <div className="sh-legend"><span><i className="sh-dot saved" />{L('Rendimentos')}</span><span><i className="sh-dot spent" />{L('Despesas')}</span></div>
          </section>

  </>);
  const totalsEl = (<>
          <div className="sh-kpis three">
            <div className="sh-kpi"><small>{L('Rendimentos')}</small><span className="sh-valline"><b className="fx-pos">{money(m.income)}</b>{cmp('inc', m.income, pm.income, true)}</span></div>
            <div className="sh-kpi"><small>{L('Despesas')}</small><span className="sh-valline"><b className="fx-neg">{money(m.expense)}</b>{cmp('exp', m.expense, pm.expense, false)}</span></div>
            <div className="sh-kpi"><small>{L('Saldo')}</small><span className="sh-valline"><b className={bal < 0 ? 'fx-neg' : 'fx-pos'}>{money(bal)}</b>{cmp('bal', bal, prevBal, true)}</span></div>
          </div>
  </>);
  const linesEl = (<>
          <section className="mv-card sh-lines">
            {m.income > 0 && <div className="sh-line"><span>{L('Salário')}</span><b>{money(m.salary)}</b></div>}
            {m.income > 0 && <div className="sh-line"><span>{L('Extras')}</span><b>{money(m.income - m.salary)}</b></div>}
            <div className="sh-line"><span>{yearly ? L('Despesas por mês') : L('Despesas por dia')}</span><span className="sh-valline"><b>{money(yearly ? perMonth : perDay)}</b>{yearly ? cmp('pm', perMonth, prevPerMonth, false) : cmp('pd', perDay, prevPerDay, false)}</span></div>
            {m.income > 0 && <div className="sh-line"><span>{L('Poupaste')}</span><b className={bal < 0 ? 'fx-neg' : 'fx-pos'}>{Math.round((bal / m.income) * 100)}% dos rendimentos</b></div>}
            <Link to={yearly ? `/transacoes?ano=${cur.y}` : `/transacoes?mes=${pref}`} className="sh-line sh-linkrow"><span>{L('Movimentos')}</span><b>{m.rows.length} <Ic d={ICON.right} size={14} /></b></Link>
          </section>
  </>);
  const catsEl = (<>
        <section className="mv-card">
          <div className="sh-seg small" role="tablist">
            <button type="button" className={kind === 'expense' ? 'on' : ''} onClick={() => setKind('expense')}>{t('blk.spending')}</button>
            <button type="button" className={kind === 'income' ? 'on' : ''} onClick={() => setKind('income')}>{t('blk.income')}</button>
          </div>
          {catRows.total === 0 ? <p className="fx-muted" style={{ textAlign: 'center' }}>{t('blk.noData')}</p> : (
            <div className="sh-cats">
              <div className="sh-donut" style={{ background: `conic-gradient(${donut})` }}><span><small>{t('blk.total')}</small><b>{money(catRows.total)}</b></span></div>
              <div className="sh-catlist">{catRows.list.map((x, i) => (
                <div key={x.id} className="sh-catrow">
                  <i className="sh-dot" style={{ background: COLS[i % COLS.length] }} />
                  <span className="sh-tx-main"><b>{x.c ? catLabel(t, x.c) : '—'}</b><span className="sh-catbar"><i style={{ width: `${x.r * 100}%`, background: COLS[i % COLS.length] }} /></span></span>
                  <span className="sh-catval"><b>{money(x.v)}</b><small>{Math.round(x.r * 100)}%</small></span>
                </div>
              ))}</div>
            </div>
          )}
        </section>
  </>);
  if (embed) return <div className="mv sh sh-embed">{{ chart: chartEl, totals: totalsEl, lines: linesEl, cal: yearly ? yearCal() : monthCal(), cats: catsEl }[embed.part]}</div>;

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><Link to="/" className="mv-sq" aria-label={L('Voltar')}><Ic d={ICON.left} size={20} /></Link><h1 className="sh-title">{yearly ? L('Resumo do ano') : L('Resumo do mês')}</h1></header>
      <div className="sh-seg sh-sumseg" role="tablist">
        <button type="button" role="tab" aria-selected={!yearly} className={yearly ? '' : 'on'} onClick={() => navigate('/visao-mensal', { replace: true })}>{t('period.month')}</button>
        <button type="button" role="tab" aria-selected={yearly} className={yearly ? 'on' : ''} onClick={() => navigate('/resumo-ano', { replace: true })}>{t('period.year')}</button>
      </div>
      <div className="sh-monthnav">
        <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={yearly ? L('Ano anterior') : L('Mês anterior')}><Ic d={ICON.left} size={18} /></button>
        <span className="mv-month">{label}</span>
        <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={yearly ? L('Ano seguinte') : L('Mês seguinte')}><Ic d={ICON.right} size={18} /></button>
      </div>
      <div className="sh-seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'sum'} className={tab === 'sum' ? 'on' : ''} onClick={() => setTab('sum')}>{L('Resumo')}</button>
        <button type="button" role="tab" aria-selected={tab === 'cat'} className={tab === 'cat' ? 'on' : ''} onClick={() => setTab('cat')}>{L('Categorias')}</button>
      </div>

      {tab === 'sum' ? (
        <>
          {chartEl}
          {totalsEl}
          {linesEl}
          {yearly ? yearCal() : monthCal()}
        </>
      ) : catsEl}
    </div>
  );
}
