// Contas e Limites, organizados como no vídeo de referência, no estilo FuturePal.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Budget, Category, Goal, Salary, Transaction, Transfer } from '../db/database';
import { accountBalanceCents, addAccount, removeAccount, updateAccount } from '../core/accounts';
import { addGoal, contributeToGoal, setBudget } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { forecastGoal, type GoalForecast } from '../core/goalForecast';
import { Ic, ICON, CatIcon, catLabel } from '../ui/fx';

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
const TYPES = [{ id: 'spending', label: 'Gastos' }, { id: 'savings', label: 'Poupança' }, { id: 'debt', label: 'Dívidas' }] as const;
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
  const delAcc = async (a: Account) => { if (window.confirm(`Apagar a conta "${a.name}"?`)) { await removeAccount(db, a.id); setEdit(null); reload(); } };
  const list = (d?.accounts ?? []).filter((a) => a.type === tab).sort((a, b) => a.order - b.order);
  const create = async () => {
    if (!name.trim()) return;
    await addAccount(db, { name: name.trim(), description: '', type: tab, currency: s.currency, initialBalanceCents: Math.abs(parseMoneyToCents(bal || '0') ?? 0), includeInNetWorth: true, isDefault: false, showOnHome: true });
    setName(''); setBal(''); setForm(false); reload();
  };

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">Contas</h1></header>
      <div className="sh-kpis">
        <div className="sh-kpi"><small>Dinheiro nas contas</small><b className={money_ < 0 ? 'fx-neg' : 'fx-pos'}>{money(money_)}</b></div>
        <div className="sh-kpi"><small>Dívidas</small><b className={debts > 0 ? 'fx-neg' : ''}>{money(debts)}</b></div>
      </div>
      <div className="sh-seg" role="tablist">
        {TYPES.map((x) => <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => { setTab(x.id); setForm(false); }}>{x.label}</button>)}
      </div>
      {tab === 'debt' && <p className="sh-info">Para baixar uma dívida, faz uma transferência de uma conta de gastos ou de poupança para a conta da dívida.</p>}
      {list.length === 0 && !form && <p className="fx-muted" style={{ textAlign: 'center', margin: '12px 0' }}>Ainda não tens contas aqui.</p>}
      {list.map((a) => (
        <div key={a.id} className="sh-accwrap">
          <button type="button" className={'acc-card sh-acc t-' + a.type} onClick={() => openEdit(a)} aria-expanded={edit === a.id}>
            <div className="acc-card-top"><span className="acc-card-ic"><Ic d={TYPE_IC[a.type]} size={16} /></span><b>{a.name}</b>{a.isDefault && <small>Principal</small>}</div>
            <div className={'acc-card-val' + (balOf(a) < 0 ? ' neg' : '')}>{money(balOf(a))}</div>
          </button>
          {edit === a.id && (
            <section className="mv-card sh-form">
              <label>Nome<input value={eName} onChange={(e) => setEName(e.target.value)} /></label>
              <label>{a.type === 'debt' ? 'Quanto deves agora' : 'Quanto tem agora'}<input inputMode="decimal" value={eBal} onChange={(e) => setEBal(e.target.value)} /></label>
              <button type="button" className="sh-btn in sm" onClick={() => saveEdit(a)}>Guardar</button>
              {!a.isDefault && <button type="button" className="sh-danger" onClick={() => delAcc(a)}>Apagar conta</button>}
            </section>
          )}
        </div>
      ))}
      {form ? (
        <section className="mv-card sh-form">
          <label>Nome da conta<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tab === 'debt' ? 'Ex.: Empréstimo da casa' : tab === 'savings' ? 'Ex.: Poupanças' : 'Ex.: Conta do banco'} /></label>
          <label>{tab === 'debt' ? 'Quanto deves' : 'Quanto tem agora'}<input inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} placeholder="0,00" /></label>
          <button type="button" className="sh-btn in sm" disabled={!name.trim()} onClick={create}>Criar conta</button>
        </section>
      ) : <button type="button" className="sh-btn in" onClick={() => setForm(true)}><Ic d={ICON.plus} size={20} />Criar conta</button>}
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
  const [cat, setCat] = useState('');
  const [amt, setAmt] = useState('');
  const reload = () => loadAll().then(setD).catch(() => {});
  useEffect(() => { reload(); }, []);

  const shift = (k: number) => setCur((c) => ({ y: c.y + Math.floor((c.m + k) / 12), m: ((c.m + k) % 12 + 12) % 12 }));
  const prefix = `${cur.y}-${String(cur.m + 1).padStart(2, '0')}`;
  const month = (d?.txs ?? []).filter((x) => x.date.startsWith(prefix));
  const received = month.filter((x) => x.type === 'income').reduce((a, x) => a + x.amountCents, 0);
  const spent = month.filter((x) => x.type === 'expense').reduce((a, x) => a + x.amountCents, 0);
  const limits = (d?.budgets ?? []).filter((b) => b.year === cur.y && b.month === cur.m + 1);
  const catOf = (id: string) => d?.cats.find((c) => c.id === id);
  const spentIn = (id: string) => month.filter((x) => x.type === 'expense' && x.categoryId === id).reduce((a, x) => a + x.amountCents, 0);
  const expenseCats = (d?.cats ?? []).filter((c) => c.group !== 'income' && !limits.some((b) => b.categoryId === c.id));
  const create = async () => {
    const cents = parseMoneyToCents(amt);
    if (!cat || !cents) return;
    await setBudget(db, cat, Math.abs(cents), cur.y, cur.m + 1);
    setCat(''); setAmt(''); setForm(false); reload();
  };
  const label = new Date(cur.y, cur.m, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' });

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">Limites do mês</h1><Link to="/orcamentos-completo" className="mv-sq" aria-label="Mais opções"><Ic d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" size={18} /></Link></header>
      <section className="mv-hero sh-hero">
        <div className="mv-hero-top">
          <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label="Mês anterior"><Ic d={ICON.left} size={18} /></button>
          <span className="mv-month">{label}</span>
          <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label="Mês seguinte"><Ic d={ICON.right} size={18} /></button>
        </div>
        <div className="sh-two">
          <span><small>Recebido</small><b className="fx-pos">{money(received)}</b></span>
          <span><small>Gasto</small><b className="fx-neg">{money(spent)}</b></span>
        </div>
        <div className="sh-row"><b>Sobra do mês</b><b className={received - spent < 0 ? 'fx-neg' : 'fx-pos'}>{money(received - spent)}</b></div>
      </section>

      <section className="mv-card">
        <div className="mv-card-head"><h2>Por categoria</h2></div>
        {limits.length === 0 && !form && <p className="fx-muted" style={{ margin: 0 }}>Escolhe uma categoria (ex.: Supermercado) e quanto queres gastar no máximo este mês.</p>}
        <div className="sh-limits">
          {limits.map((b) => {
            const c = catOf(b.categoryId), used = spentIn(b.categoryId), r = b.limitCents > 0 ? used / b.limitCents : 0, left = b.limitCents - used;
            return (
              <div key={b.id} className={'sh-limit' + (r > 1 ? ' over' : r > 0.85 ? ' warn' : '')} style={{ ['--p' as string]: Math.min(1, r) }}>
                <span className="sh-ring"><CatIcon cat={c ?? {}} size={44} /></span>
                <b>{c ? catLabel(t, c) : '—'}</b>
                <small>{left >= 0 ? `sobram ${money(left)}` : `passaste ${money(-left)}`}</small>
              </div>
            );
          })}
        </div>
        {form ? (
          <div className="sh-form">
            <label>Categoria<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Escolher…</option>{expenseCats.map((c) => <option key={c.id} value={c.id}>{catLabel(t, c)}</option>)}</select></label>
            <label>Máximo por mês<input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Ex.: 200" /></label>
            <button type="button" className="sh-btn in sm" disabled={!cat || !amt} onClick={create}>Guardar limite</button>
          </div>
        ) : <button type="button" className="sh-btn out sm" onClick={() => setForm(true)}><Ic d={ICON.plus} size={18} />Novo limite</button>}
      </section>
    </div>
  );
}

// ── Metas (como no vídeo): lista de cartões; tocar abre o detalhe; "Criar meta" com valor, notas e contas que contam
export function SimpleGoals() {
  const money = useMoney();
  const s = loadSettings();
  const [d, setD] = useState<(Data & { goals: Goal[] }) | null>(null);
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
  const create = async () => {
    const cents = parseMoneyToCents(target);
    if (!name.trim() || !cents) return;
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
        <header className="mv-head"><button type="button" className="mv-sq" onClick={() => setOpen(null)} aria-label="Voltar"><Ic d={ICON.left} size={20} /></button><h1 className="sh-title">{g.name}</h1></header>
        <section className="mv-hero sh-hero">
          <div className="sh-two">
            <span><small>Já tens</small><b className={cur < 0 ? 'fx-neg' : 'fx-pos'}>{money(cur)}</b></span>
            <span><small>Falta</small><b>{money(left)}</b></span>
          </div>
          <div className="sh-row"><small className="sh-pct">Objetivo: {money(g.targetCents)}</small><b>{Math.round(r * 100)}%</b></div>
          <div className="sh-bar"><i style={{ width: `${r * 100}%` }} /></div>
        </section>
        <section className="mv-card">
          <div className="mv-card-head"><h2>Previsão</h2></div>
          <p className="fx-muted" style={{ margin: 0 }}>{forecastLong(g, cur)}</p>
          {(() => { const di = deadlineInfo(g, cur); return di ? <p className={'sh-alert' + (di.ok ? ' ok' : '')}>{di.long}</p> : null; })()}
        </section>
        {g.notes && <section className="mv-card"><div className="mv-card-head"><h2>Notas</h2></div><p style={{ margin: 0 }}>{g.notes}</p></section>}
        {!g.accountIds?.length && (
          <section className="mv-card sh-form">
            <label>Juntar dinheiro a esta meta<input inputMode="decimal" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Ex.: 50" /></label>
            <button type="button" className="sh-btn in sm" disabled={!add} onClick={async () => { const c = parseMoneyToCents(add); if (c) { await contributeToGoal(db, g.id, Math.abs(c)); setAdd(''); reload(); } }}>Juntar</button>
          </section>
        )}
        <button type="button" className="sh-danger" onClick={async () => { if (window.confirm(`Apagar a meta "${g.name}"?`)) { const t2 = new Date().toISOString(); await db.goals.update(g.id, { deletedAt: t2, updatedAt: t2 }); setOpen(null); reload(); } }}>Apagar meta</button>
      </div>
    );
  }

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">Metas</h1></header>
      {(d?.goals ?? []).length === 0 && !form && <p className="fx-muted" style={{ textAlign: 'center' }}>Uma meta é um objetivo para juntar dinheiro (ex.: 1000 € para férias).</p>}
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
      {form ? (
        <section className="mv-card sh-form">
          <label>O que queres juntar?<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Férias, carro, emergências" /></label>
          <label>Quanto queres juntar<input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Ex.: 1000" /></label>
          <label className="sh-toggle"><span><b>Tem data limite?</b><small>Ex.: quero ter o dinheiro até ao verão</small></span>
            <input type="checkbox" checked={hasDeadline} onChange={(e) => setHasDeadline(e.target.checked)} /></label>
          {hasDeadline && <label>Até quando<input type="date" value={deadline} min={now.toISOString().slice(0, 10)} onChange={(e) => setDeadline(e.target.value)} /></label>}
          <label>Notas (opcional)<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: para o verão de 2027" /></label>
          <div className="sh-accpick"><small>Como queres juntar?</small>
            <div className="sh-seg small">
              <button type="button" className={how === 'hand' ? 'on' : ''} onClick={() => { setHow('hand'); setAccs([]); }}>Vou juntando à mão</button>
              <button type="button" className={how === 'accounts' ? 'on' : ''} onClick={() => setHow('accounts')}>Usar o saldo de contas</button>
            </div>
          </div>
          {how === 'accounts' && (d?.accounts ?? []).filter((a) => a.type !== 'debt').length > 0 && (
            <div className="sh-accpick">
              <small>Quais contas contam para esta meta?</small>
              {(d?.accounts ?? []).filter((a) => a.type !== 'debt').map((a) => (
                <label key={a.id} className="sh-toggle"><span><b>{a.name}</b><small>{money(balOf(a))}</small></span>
                  <input type="checkbox" checked={accs.includes(a.id)} onChange={(e) => setAccs(e.target.checked ? [...accs, a.id] : accs.filter((x) => x !== a.id))} /></label>
              ))}
            </div>
          )}
          <button type="button" className="sh-btn in sm" disabled={!name.trim() || !target} onClick={create}>Criar meta</button>
        </section>
      ) : <button type="button" className="sh-pill" onClick={() => setForm(true)}><Ic d={ICON.plus} size={16} />Criar meta</button>}
    </div>
  );
}

// ── Resumo do mês (como o "Overview" do vídeo): mês com setas → Resumo | Categorias →
//    barras dos últimos 6 meses → saldo do mês → Recebido / Gasto → movimentos agrupados por dia
export function SimpleOverview({ yearly = false }: { yearly?: boolean }) {
  const { t } = useTranslation();
  const money = useMoney();
  const s = loadSettings();
  const now = new Date();
  const [d, setD] = useState<Data | null>(null);
  const qYear = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('ano')) || now.getFullYear();
  const [cur, setCur] = useState({ y: yearly ? qYear : now.getFullYear(), m: now.getMonth() });
  const [tab, setTab] = useState<'sum' | 'cat'>('sum');
  const navigate = useNavigate();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  useEffect(() => { loadAll().then(setD).catch(() => {}); }, []);

  const shift = (k: number) => setCur((c) => (yearly ? { y: c.y + k, m: c.m } : { y: c.y + Math.floor((c.m + k) / 12), m: ((c.m + k) % 12 + 12) % 12 }));
  const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const sumOf = (pref: string) => {
    const rows = (d?.txs ?? []).filter((x) => x.date.startsWith(pref));
    const inc = rows.filter((x) => x.type === 'income'), exp = rows.filter((x) => x.type === 'expense');
    return { rows, income: inc.reduce((a, x) => a + x.amountCents, 0), salary: inc.filter((x) => x.id.startsWith('sal-')).reduce((a, x) => a + x.amountCents, 0), expense: exp.reduce((a, x) => a + x.amountCents, 0) };
  };
  const pref = yearly ? String(cur.y) : key(cur.y, cur.m);
  const m = sumOf(pref);
  const bal = m.income - m.expense;
  // comparação com o mês (ou ano) anterior, como no Início
  const pm = yearly ? sumOf(String(cur.y - 1)) : sumOf(key(cur.m === 0 ? cur.y - 1 : cur.y, (cur.m + 11) % 12));
  const prevBal = pm.income - pm.expense;
  // nome do período anterior, em palavras ("outubro", "2025")
  const prevName = yearly ? String(cur.y - 1)
    : new Intl.DateTimeFormat(loadSettings().language, { month: 'long' }).format(new Date(cur.m === 0 ? cur.y - 1 : cur.y, (cur.m + 11) % 12, 1));
  const cmp = (now_: number, before: number, upIsGood: boolean) => {
    if (before === 0) return null;
    const pctv = Math.round(((now_ - before) / Math.abs(before)) * 100);
    const tone = pctv === 0 ? 'same' : (pctv > 0) === upIsGood ? 'good' : 'bad';
    const words = pctv > 0 ? `mais do que em ${prevName}` : pctv < 0 ? `menos do que em ${prevName}` : `igual a ${prevName}`;
    return (
      <span className="sh-trend-wrap" title={`${pctv > 0 ? '+' : ''}${pctv}% em relação a ${prevName}`}>
        <span className={'sh-trend ' + tone}>{pctv > 0 ? '▲' : pctv < 0 ? '▼' : '●'} {Math.abs(pctv)}%</span>
        <span className="sh-trend-words">{words}</span>
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
            <div className="mv-card-head"><h2>Despesas por dia</h2></div>
            <div className="sh-cal">
              {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((w, k) => <span key={k} className="sh-calh">{w}</span>)}
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
            {best && <div className="sh-bestcard"><i><Ic d="M12 19V5M5 12l7-7 7 7" size={16} /></i><span><small>Maior despesa</small><b>{new Date(cur.y, cur.m, +best[0]).toLocaleDateString(s.language, { day: 'numeric', month: 'long' })}</b></span><strong>{money(best[1])}</strong></div>}
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
        <div className="mv-card-head"><h2>Despesas por mês</h2></div>
        <div className="sh-ycal">
          {tot.map((v, k) => (
            <button key={k} type="button" className={'sh-ymonth' + (cur.y === now.getFullYear() && k === now.getMonth() ? ' today' : '')} style={{ ['--i' as string]: top && v ? 0.15 + 0.6 * (v / top) : 0 }} onClick={() => navigate(`/transacoes?mes=${key(cur.y, k)}`)}>
              <span>{new Date(cur.y, k, 1).toLocaleDateString(s.language, { month: 'short' }).replace('.', '')}</span>
              <small>{v ? money(v) : '—'}</small>
            </button>
          ))}
        </div>
        {top > 0 && <div className="sh-bestcard"><i><Ic d="M12 19V5M5 12l7-7 7 7" size={16} /></i><span><small>Maior despesa</small><b>{new Date(cur.y, bestM, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' })}</b></span><strong>{money(top)}</strong></div>}
      </section>
    );
  };

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><Link to="/" className="mv-sq" aria-label="Voltar"><Ic d={ICON.left} size={20} /></Link><h1 className="sh-title">{yearly ? 'Resumo do ano' : 'Resumo do mês'}</h1></header>
      <div className="sh-monthnav">
        <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={yearly ? 'Ano anterior' : 'Mês anterior'}><Ic d={ICON.left} size={18} /></button>
        <span className="mv-month">{label}</span>
        <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={yearly ? 'Ano seguinte' : 'Mês seguinte'}><Ic d={ICON.right} size={18} /></button>
      </div>
      <div className="sh-seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'sum'} className={tab === 'sum' ? 'on' : ''} onClick={() => setTab('sum')}>Resumo</button>
        <button type="button" role="tab" aria-selected={tab === 'cat'} className={tab === 'cat' ? 'on' : ''} onClick={() => setTab('cat')}>Categorias</button>
      </div>

      {tab === 'sum' ? (
        <>
          <section className="mv-card">
            <div className="sh-bars" aria-label="Meses" ref={(el) => { const all = el ? [...el.querySelectorAll('.sh-barcol.has')] : []; const on = (el?.querySelector('.sh-barcol.on') ?? all[all.length - 1] ?? null) as HTMLElement | null; if (el && on) el.scrollTo({ left: on.offsetLeft - el.clientWidth / 2 + on.clientWidth / 2, behavior: 'smooth' }); }}>
              {bars.map((b) => (
                <button key={b.y + '-' + b.mo} type="button" className={'sh-barcol' + (!yearly && b.y === cur.y && b.mo === cur.m ? ' on' : '') + (b.income || b.expense ? ' has' : '')} onClick={() => setCur({ y: b.y, m: b.mo })} aria-pressed={!yearly && b.y === cur.y && b.mo === cur.m}>
                  <span className="sh-barpair"><i className="inc" style={{ height: `${(b.income / max) * 100}%` }} /><i className="exp" style={{ height: `${(b.expense / max) * 100}%` }} /></span>
                  <small>{new Date(b.y, b.mo, 1).toLocaleDateString(s.language, { month: 'short' }).replace('.', '')}{b.mo === 0 ? ` ${String(b.y).slice(2)}` : ''}</small>
                </button>
              ))}
            </div>
            <div className="sh-legend"><span><i className="sh-dot saved" />Rendimentos</span><span><i className="sh-dot spent" />Despesas</span></div>
          </section>

          <div className="sh-kpis three">
            <div className="sh-kpi"><small>Rendimentos</small><b className="fx-pos">{money(m.income)}</b>{cmp(m.income, pm.income, true)}</div>
            <div className="sh-kpi"><small>Despesas</small><b className="fx-neg">{money(m.expense)}</b>{cmp(m.expense, pm.expense, false)}</div>
            <div className="sh-kpi"><small>Saldo</small><b className={bal < 0 ? 'fx-neg' : 'fx-pos'}>{money(bal)}</b>{cmp(bal, prevBal, true)}</div>
          </div>
          <section className="mv-card sh-lines">
            {m.income > 0 && <div className="sh-line"><span>Salário</span><b>{money(m.salary)}</b></div>}
            {m.income > 0 && <div className="sh-line"><span>Extras</span><b>{money(m.income - m.salary)}</b></div>}
            <div className="sh-line"><span>{yearly ? 'Despesas por mês' : 'Despesas por dia'}</span><b>{money(yearly ? perMonth : perDay)}</b></div>
            {m.income > 0 && <div className="sh-line"><span>Poupaste</span><b className={bal < 0 ? 'fx-neg' : 'fx-pos'}>{Math.round((bal / m.income) * 100)}% dos rendimentos</b></div>}
            <Link to={yearly ? `/transacoes?ano=${cur.y}` : `/transacoes?mes=${pref}`} className="sh-line sh-linkrow"><span>Movimentos</span><b>{m.rows.length} <Ic d={ICON.right} size={14} /></b></Link>
          </section>
          {yearly ? yearCal() : monthCal()}
        </>
      ) : (
        <section className="mv-card">
          <div className="sh-seg small" role="tablist">
            <button type="button" className={kind === 'expense' ? 'on' : ''} onClick={() => setKind('expense')}>Gastos</button>
            <button type="button" className={kind === 'income' ? 'on' : ''} onClick={() => setKind('income')}>Rendimentos</button>
          </div>
          {catRows.total === 0 ? <p className="fx-muted" style={{ textAlign: 'center' }}>Sem dados neste mês.</p> : (
            <>
              <div className="sh-donut" style={{ background: `conic-gradient(${donut})` }}><span><small>Total</small><b>{money(catRows.total)}</b></span></div>
              {catRows.list.map((x, i) => (
                <div key={x.id} className="sh-catrow">
                  <i className="sh-dot" style={{ background: COLS[i % COLS.length] }} />
                  <span className="sh-tx-main"><b>{x.c ? catLabel(t, x.c) : '—'}</b><span className="sh-catbar"><i style={{ width: `${x.r * 100}%`, background: COLS[i % COLS.length] }} /></span></span>
                  <span className="sh-catval"><b>{money(x.v)}</b><small>{Math.round(x.r * 100)}%</small></span>
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
