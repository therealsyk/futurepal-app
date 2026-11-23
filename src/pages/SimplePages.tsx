// Contas e Limites, organizados como no vídeo de referência, no estilo FuturePal.
import { beforePayments, goalValueCents, joinDesc, payoff, planInfo, splitDesc } from '../core/debtPlan';
import { AccountPlanBox, endText as planEnd, fill } from '../ui/AccountPlan';
import { NewAccount, type AccountEdit } from './NewAccount';
import { addGoal } from '../core/finance';
import { todayISO } from '../core/dates';
import { NewGoal } from './NewGoal';
import { GoalCard, GoalView, type GoalInfo } from './GoalView';
import { GoalRing } from '../ui/GoalRing';
import { GTile } from './Split';
import { milestone } from '../core/onboarding';
import { DebtBoost, MoreInfo, PaymentList } from './DebtBoost';
import { CountMoney } from '../ui/CountMoney';
import { allPayments, inPeriod, isEssential } from '../core/payments';
import { hasFeature } from '../core/plan';
import { ignoredList } from './Recurring';
import { cmpShort } from '../core/compare';
import { useMissing } from '../ui/missing';
import { useEffect, useRef, useState } from 'react';
import { useFitSheet } from '../ui/useFitSheet';
import { appConfirm } from '../ui/confirm';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Budget, Category, Goal, Recurring, Salary, Transaction, Transfer } from '../db/database';
import { accountBalanceCents, removeAccount, updateAccount } from '../core/accounts';
import { setBudget } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { forecastGoal, type GoalForecast } from '../core/goalForecast';
import { goalMonthlyIn } from '../core/goalEta';
import { Ic, ICON, CatIcon, catLabel } from '../ui/fx';
import { AmountField, CategoryRow, FI, SwitchRow } from '../ui/formFields';
import { EmptyState } from '../ui/EmptyState';
import { L } from '../i18n/phrases';
import { DatePicker } from '../ui/DatePicker';
import { openTxForm } from '../ui/TxForm';

// Folha que sobe do fundo do ecrã (resto desfocado). Voltar, tocar fora ou Esc fecham.
export function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  useFitSheet(body);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <div className="bs-backdrop" onClick={onClose}>
      <div className="bs-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="bs-grab" aria-hidden="true" />
        <header className="bs-head"><button type="button" className="bs-back" onClick={onClose}><Ic d={ICON.left} size={18} />{L('Voltar')}</button><h2>{title}</h2><span /></header>
        <div className="bs-body" ref={body}>{children}</div>
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
// nomes lidos na altura: assim seguem a língua escolhida
const TYPES = [{ id: 'spending', get label() { return L('Gastos'); } }, { id: 'savings', get label() { return L('Poupança'); } }, { id: 'debt', get label() { return L('Dívidas'); } }] as const;
const TYPE_IC: Record<string, string> = { spending: ICON.wallet, savings: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2z', debt: 'M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5' };

export function SimpleAccounts() {
  const money = useMoney();
  const s = loadSettings();
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState<'spending' | 'savings' | 'debt'>(() => { const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab'); return q === 'debt' || q === 'savings' ? q : 'spending'; });
  const [form, setForm] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [openAcc, setOpenAcc] = useState<string | null>(null); // poupança/dívida aberta na lista
  const reload = () => { loadAll().then(setD).catch(() => {}); db.goals.toArray().then((g) => setGoals(live(g))).catch(() => {}); };
  useEffect(() => { reload(); }, []);

  const now = new Date();
  const salaryToDate = (d?.salaries ?? []).filter((x) => x.year * 100 + x.month <= now.getFullYear() * 100 + now.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
  const balOf = (a: Account) => (d ? accountBalanceCents(a, d.txs, d.accounts, salaryToDate, d.transfers) : 0);
  // Mesma conta que o Início: dinheiro nas contas (sem dívidas) e, à parte, quanto se deve
  const money_ = (d?.accounts ?? []).filter((a) => a.type !== 'debt').reduce((sum, a) => sum + balOf(a), 0);
  const debts = (d?.accounts ?? []).filter((a) => a.type === 'debt').reduce((sum, a) => sum + balOf(a), 0);
  const openEdit = (a: Account) => setEdit(a.id);
  const closeEdit = () => setEdit(null);
  const saveEdit = async (a: Account, e: AccountEdit) => {
    const before = balOf(a), old = splitDesc(a.description).plan, v = e.balCents;
    // dívida: o que devia no início não muda quando a pessoa corrige quanto deve agora (a não ser que deva mais)
    const plan = a.type === 'spending' ? null : { monthlyCents: e.monthlyCents, startCents: a.type === 'debt' ? Math.max(v, old?.startCents ?? Math.max(a.initialBalanceCents, before)) : old?.startCents ?? 0, rate: (a.type === 'debt' && e.rate) || undefined, goalId: old?.goalId };
    // acompanhamento (meta ligada à conta): data limite e quanto juntar
    if (plan && e.goal) {
      const total = a.type === 'debt' ? plan.startCents : e.targetCents, g = goals.find((x) => x.id === old?.goalId);
      if (g) await db.goals.update(g.id, { name: e.name, targetDate: e.end, targetCents: total || g.targetCents, updatedAt: new Date().toISOString() });
      else {
        const n = await addGoal(db, e.name, total, todayISO(), e.end);
        await db.goals.update(n.id, { notes: e.desc.trim() || undefined, accountIds: [a.id] });
        plan.goalId = n.id;
      }
    }
    // com juros, o valor inicial é o que dá exatamente o saldo escrito depois do que já foi pago
    const paid = a.type === 'debt' ? (d?.transfers ?? []).filter((t2) => t2.toAccountId === a.id).reduce((x, t2) => x + t2.amountCents, 0) : 0;
    const base = d ? accountBalanceCents(a, d.txs, d.accounts, salaryToDate, d.transfers.filter((t2) => t2.toAccountId !== a.id)) : 0;
    const init = a.type === 'debt' ? a.initialBalanceCents + beforePayments(v, paid, plan) - base : a.initialBalanceCents + (v - before);
    await updateAccount(db, a.id, { name: e.name, description: joinDesc(e.desc, plan), initialBalanceCents: init });
    closeEdit(); reload();
  };
  const delAcc = async (a: Account) => {
    const gid = splitDesc(a.description).plan?.goalId;
    if (!(await appConfirm(`${L('Apagar conta')} "${a.name}"?` + (gid ? ' ' + L('O acompanhamento desta conta também é apagado.') : '')))) return;
    const t2 = new Date().toISOString();
    if (gid) await db.goals.update(gid, { deletedAt: t2, updatedAt: t2 });
    for (const x of await db.recurrings.toArray()) if (x.toAccountId === a.id && x.deletedAt === null) await db.recurrings.update(x.id, { deletedAt: t2, updatedAt: t2 }); // sem transferências para uma conta que já não existe
    await removeAccount(db, a.id); closeEdit(); reload();
  };
  const list = (d?.accounts ?? []).filter((a) => a.type === tab).sort((a, b) => a.order - b.order);
  const endText = (months: number) => planEnd(months, s.language);
  const editing = (d?.accounts ?? []).find((a) => a.id === edit);

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
          <button type="button" className={'acc-card sh-acc t-' + a.type} onClick={() => (a.type === 'spending' ? openEdit(a) : setOpenAcc(openAcc === a.id ? null : a.id))} aria-expanded={a.type === 'spending' ? undefined : openAcc === a.id} aria-label={a.type === 'spending' ? `${L('Alterar conta')}: ${a.name}` : a.name}>
            {a.type !== 'spending' && <span className="acc-chev"><Ic d={ICON.down} size={18} /></span>}
            <div className="acc-card-top"><span className="acc-card-ic"><Ic d={TYPE_IC[a.type]} size={16} /></span><b>{a.name}</b>{a.isDefault && a.name !== L('Principal') && <small>{L('Principal')}</small>}</div>
            <div className={'acc-card-val' + (balOf(a) < 0 ? ' neg' : '')}>{money(balOf(a))}</div>
          </button>
          {a.type === 'spending' ? splitDesc(a.description).text && <p className="acc-desc">{splitDesc(a.description).text}</p> : (
            <div className={'acc-exp' + (openAcc === a.id ? ' open' : '')} aria-hidden={openAcc !== a.id} inert={openAcc !== a.id}><div>
              <AccountPlanBox a={a} p={planInfo(a, balOf(a), d?.transfers ?? [], goals.find((x) => x.id === splitDesc(a.description).plan?.goalId), now)} money={money} lang={s.language} onEdit={() => openEdit(a)} more={<MoreInfo id={a.id} />}>
                <div className="db-inbox"><h3>{a.type === 'debt' ? L('Pagamentos feitos') : L('Dinheiro que entrou')}</h3><PaymentList a={a} transfers={d?.transfers ?? []} txs={d?.txs ?? []} accounts={d?.accounts ?? []} money={money} lang={s.language} /></div>
              </AccountPlanBox>
            </div></div>
          )}
        </div>
      ))}
<button type="button" className="sh-btn in" onClick={() => setForm(true)}><Ic d={ICON.plus} size={20} />{L('Criar conta')}</button>
      {form && <NewAccount initial={tab} accounts={d?.accounts ?? []} balOf={balOf} money={money} endText={endText} onClose={() => setForm(false)} onDone={(k) => { setForm(false); setTab(k); reload(); }} />}
      {editing && <NewAccount key={editing.id} initial={editing.type} accounts={d?.accounts ?? []} balOf={balOf} money={money} endText={endText} onClose={closeEdit} onDone={() => {}}
        edit={{ acc: editing, goal: goals.find((x) => x.id === splitDesc(editing.description).plan?.goalId), onSave: (e) => saveEdit(editing, e), onDelete: editing.isDefault ? undefined : () => delAcc(editing) }} />}
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
  const [editHas, setEditHas] = useState(false), [editEnd, setEditEnd] = useState(''); // alterar: data limite (AAAA-MM)
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
  const ymOf = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
  const missEdit = missingEdit([['amount', L('o valor'), (parseMoneyToCents(editAmt) ?? 0) > 0], ['end', L('a data limite'), !editHas || (!!edit && editEnd >= ymOf(edit.year, edit.month))]]);
  // meses seguidos, depois deste, que já têm o mesmo limite: é até aí que ele vai
  const chain = (b: Budget): Budget[] => {
    const out: Budget[] = [];
    for (let y = b.year, m = b.month; ;) {
      m++; if (m > 12) { m = 1; y++; }
      const next = (d?.budgets ?? []).filter((x) => x.categoryId === b.categoryId && x.year === y && x.month === m);
      if (!next.length) return out;
      out.push(...next);
    }
  };
  const openEdit = (b: Budget) => {
    const last = chain(b).pop();
    setEdit(b); setEditAmt((b.limitCents / 100).toFixed(2).replace('.', ',')); setEditHas(!!last); setEditEnd(last ? ymOf(last.year, last.month) : '');
  };
  const saveEdit = async () => {
    const cents = parseMoneyToCents(editAmt);
    if (!edit || !missEdit.check() || !cents) return;
    const end = editHas ? editEnd : ymOf(edit.year, edit.month);
    for (let y = edit.year, m = edit.month; ymOf(y, m) <= end;) { await setBudget(db, edit.categoryId, Math.abs(cents), y, m); m++; if (m > 12) { m = 1; y++; } }
    const t2 = new Date().toISOString(); // os meses para lá da data deixam de ter este limite
    for (const x of chain(edit)) if (ymOf(x.year, x.month) > end) await db.budgets.update(x.id, { deletedAt: t2, updatedAt: t2 });
    setEdit(null); missEdit.reset(); reload();
  };
  const closeForm = () => { setForm(false); miss.reset(); };
  const create = async () => {
    const cents = parseMoneyToCents(amt);
    if (!miss.check() || !cents) return;
    milestone('limit');
    // com data limite: o mesmo limite em todos os meses até lá; sem data: só este mês
    let y = cur.y, mo = cur.m + 1;
    const [ey, em] = hasEnd && endM ? endM.split('-').map(Number) : [y, mo];
    while (y * 100 + mo <= ey * 100 + em) { await setBudget(db, cat, Math.abs(cents), y, mo); mo++; if (mo > 12) { mo = 1; y++; } }
    setHasEnd(false); setEndM('');
    setCat(''); setAmt(''); setForm(false); reload();
  };
  const label = new Date(cur.y, cur.m, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' });

  const total = limits.reduce((a, b) => a + b.limitCents, 0), used = limits.reduce((a, b) => a + spentIn(b.categoryId), 0), left = total - used;
  const ratio = total > 0 ? used / total : 0, toneOf = (r: number) => (r > 1 ? 'over' : r > 0.85 ? 'warn' : '');
  const isNow = cur.y === now.getFullYear() && cur.m === now.getMonth(), daysLeft = new Date(cur.y, cur.m + 1, 0).getDate() - now.getDate() + 1; // hoje conta
  const rows = limits.map((b) => { const u = spentIn(b.categoryId); return { b, u, r: b.limitCents > 0 ? u / b.limitCents : 0, left: b.limitCents - u, c: catOf(b.categoryId) }; }).sort((a, b) => b.r - a.r); // primeiro os que estão mais perto do fim

  return (
    <div className="fx-page mv sh lm-page">
      <header className="mv-head"><h1 className="sh-title">{L('Limites do mês')}</h1><Link to="/orcamentos-completo" className="mv-sq lim-adv" aria-label={L('Mais opções')}><Ic d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" size={18} /></Link></header>
      <section className={'mv-hero sh-hero lm-hero' + (limits.length ? '' : ' none')}>
        <div className="mv-hero-top">
          <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={L('Mês anterior')}><Ic d={ICON.left} size={18} /></button>
          <span className="mv-month">{label}</span>
          <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={L('Mês seguinte')}><Ic d={ICON.right} size={18} /></button>
        </div>
        {limits.length > 0 && <div className="gl-hero lm-sum" key={prefix}>
          <GoalRing r={Math.min(1, ratio)} size={176} tone={toneOf(ratio)}><b>{Math.round(ratio * 100)}%</b><small>{L('gasto')}</small></GoalRing>
          <div className="gl-have"><small>{left >= 0 ? L('Ainda podes gastar') : L('Passaste os limites em')}</small><b className={left >= 0 ? 'fx-pos' : 'fx-neg'}>{money(Math.abs(left))}</b>
            {isNow && left > 0 && <small>{fill(L('cerca de {m} por dia'), { m: money(Math.floor(left / daysLeft)) })}</small>}</div>
        </div>}
      </section>
      {limits.length > 0 && <div className="gx-tiles lm-tiles">
        <GTile d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" label={L('Limite total')} value={money(total)} />
        <GTile d="M12 19V5M5 12l7-7 7 7" tone={left < 0 ? 'neg' : ''} label={L('Já gastaste')} value={money(used)} />
        <GTile d="M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z" label={L('Limites')} value={String(limits.length)} />
      </div>}
      {d && limits.length === 0 && <EmptyState icon="M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z" title={L('Sem limites este mês')} text={L('Define quanto queres gastar no máximo numa categoria. A app avisa quando estiveres perto.')} examples={['🛒 Supermercado', '⛽ Combustível', '🍽️ Restaurantes']} />}
      {rows.length > 0 && <div className="gl-grid" key={prefix + 'g'}>
        {rows.map(({ b, u, r, left: l, c }, i) => (
          <button type="button" key={b.id} className="mv-card gl-card lm-card" style={{ ['--i' as string]: i }}
            onClick={() => openEdit(b)} aria-label={`${L('Alterar limite')}: ${c ? catLabel(t, c) : ''}`}>
            <GoalRing r={Math.min(1, r)} size={86} tone={toneOf(r)}><CatIcon cat={c ?? {}} size={52} /></GoalRing>
            <span className="gl-main">
              <b className="gl-name">{c ? catLabel(t, c) : '—'}</b>
              <span className="lm-left"><small>{l >= 0 ? L('Podes gastar') : L('Passaste')}</small> <b className={l < 0 ? 'fx-neg' : r > 0.85 ? 'lm-warn' : 'fx-pos'}>{money(Math.abs(l))}</b></span>
              <span className="gl-money">{money(u)} {L('de')} {money(b.limitCents)}</span>
            </span>
            <span className={'lm-tag ' + (toneOf(r) || 'ok')}>{Math.round(r * 100)}%</span>
          </button>
        ))}
      </div>}
      <button type="button" className="sh-pill" onClick={() => setForm(true)}><Ic d={ICON.plus} size={16} />{L('Novo limite')}</button>
      {edit && (() => { const c = catOf(edit.categoryId); return (
        <BottomSheet title={L('Alterar limite')} onClose={() => { setEdit(null); setDelConfirm(false); missEdit.reset(); }}>
          <div className="acc-form">
            {missEdit.note}
            <div className="lim-editcat"><CatIcon cat={c ?? {}} size={40} /><b>{c ? catLabel(t, c) : '—'}</b></div>
            <AmountField value={editAmt} onChange={setEditAmt} currency={s.currency} label={L('Máximo por mês')} cls={missEdit.cls('amount')} />
            <div className="tx-rows">
              <SwitchRow icon={FI.date} cls={missEdit.cls('end')} label={editHas ? L('Até ao mês') : L('Tem data limite?')} sub={editHas ? undefined : L('Se não ativares, fica só para este mês')} on={editHas} onChange={setEditHas}><DatePicker value={editEnd ? editEnd + '-01' : ''} onChange={(v) => setEditEnd(v.slice(0, 7))} className="fx-input tx-val" /></SwitchRow>
            </div>
            <button type="button" className="tx-addbtn" onClick={saveEdit}>{L('Guardar')}</button>
            <button type="button" className="gx-rm lm-del" onClick={async () => {
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
          <div className="acc-form">
            {miss.note}
            <AmountField value={amt} onChange={setAmt} currency={s.currency} label={L('Máximo por mês')} cls={miss.cls('amount')} />
            <div className="tx-rows">
              <CategoryRow required cats={expenseCats} kind="expense" value={cat} onChange={setCat} cls={miss.cls('cat')} />
              <SwitchRow icon={FI.date} cls={miss.cls('end')} label={hasEnd ? L('Até ao mês') : L('Tem data limite?')} sub={hasEnd ? undefined : L('Se não ativares, fica só para este mês')} on={hasEnd} onChange={setHasEnd}><DatePicker value={endM ? endM + '-01' : ''} onChange={(v) => setEndM(v.slice(0, 7))} className="fx-input tx-val" /></SwitchRow>
            </div>
            <button type="button" className="tx-addbtn" onClick={create}>{L('Guardar limite')}</button>
          </div>
        
      </BottomSheet>}
    </div>
  );
}

// ── Metas (como no vídeo): lista de cartões; tocar abre o detalhe; "Criar meta" com valor, notas e contas que contam
export function SimpleGoals() {
  const money = useMoney();
  const s = loadSettings();
  const [d, setD] = useState<(Data & { goals: Goal[] }) | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [fromAcc] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('conta')); // vindo de uma conta de poupança/dívida
  const [left_, setLeft] = useState(false);
  const navigate = useNavigate();
  const [form, setForm] = useState(false);
  const reload = async () => setD({ ...(await loadAll()), goals: live(await db.goals.toArray()) });
  useEffect(() => { reload().catch(() => {}); }, []);

  const now = new Date();
  const salaryToDate = (d?.salaries ?? []).filter((x) => x.year * 100 + x.month <= now.getFullYear() * 100 + now.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
  const balOf = (a: Account) => (d ? accountBalanceCents(a, d.txs, d.accounts, salaryToDate, d.transfers) : 0);
  const currentOf = (g: Goal) => (g.accountIds?.length ? (d?.accounts ?? []).filter((a) => g.accountIds!.includes(a.id)).reduce((x, a) => x + goalValueCents(a, balOf(a)), 0) : g.currentCents);
  // Quanto entrou na meta em cada um dos últimos 8 meses (o último é o mês atual)
  const monthlyIn = (g: Goal): number[] => (d ? goalMonthlyIn(g, d, now) : []);
  const dayRatio = now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const fc = (g: Goal, cur: number): GoalForecast => {
    // conta com um valor certo por mês: a previsão é a do plano (a mesma que aparece na conta)
    const acc = (d?.accounts ?? []).find((a) => 'acc:' + a.id === g.id || splitDesc(a.description).plan?.goalId === g.id), plan = acc ? splitDesc(acc.description).plan : null;
    if (acc && plan && plan.monthlyCents > 0) {
      const left = Math.max(0, g.targetCents - cur), m = plan.monthlyCents;
      const etaMonths = acc.type === 'debt' ? payoff(Math.max(0, balOf(acc)), m, plan.rate)?.months ?? null : Math.ceil(left / m);
      return { etaMonths, perMonthCents: m, usualCents: m, trend: 'stable', months: 3 };
    }
    const gm = splitDesc(g.notes).plan?.monthlyCents ?? 0; // meta com um valor certo por mês
    if (gm > 0) return { etaMonths: Math.ceil(Math.max(0, g.targetCents - cur) / gm), perMonthCents: gm, usualCents: gm, trend: 'stable', months: 3 };
    return forecastGoal(monthlyIn(g), Math.max(0, g.targetCents - cur), dayRatio);
  };
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
    if (!late) return { ok: true, short: fill(L('Vais a tempo: {d}'), { d: until }), long: fill(L('Estás no bom caminho: a este ritmo chegas antes de {d}.'), { d: until }) };
    return { ok: false, short: fill(L('⚠ A este ritmo não chegas até {d}'), { d: until }),
      long: fill(L('A este ritmo não chegas até {d}. Precisas de juntar cerca de {m} por mês.'), { d: until, m: money(need) }) + ' ' + (tight ? fill(L('Com os teus gastos atuais sobram-te cerca de {m} por mês, por isso terias de gastar menos ou adiar a data.'), { m: money(Math.max(0, surplus)) }) : fill(L('Costuma sobrar-te cerca de {m} por mês: consegues, se juntares mais à meta.'), { m: money(surplus) })) };
  };
  const forecastLong = (g: Goal, cur: number, debt = false) => {
    const f = fc(g, cur);
    if (f.etaMonths === 0) return L('Parabéns, chegaste ao objetivo! 🎉');
    if (f.etaMonths === null) return L('Ainda não há dados suficientes. Junta dinheiro durante um ou dois meses e a previsão aparece aqui.');
    const v = { m: money(f.perMonthCents), u: money(f.usualCents) };
    const how = f.trend === 'up' ? fill(L('Estás a juntar mais do que antes: cerca de {m} por mês (antes eram {u}).'), v) : f.trend === 'down' ? fill(L('Nos últimos meses juntaste menos: cerca de {m} por mês (antes eram {u}).'), v) : fill(L('Costumas juntar cerca de {m} por mês.'), v);
    return how + ' ' + fill(debt ? L('A este ritmo, acabas em {d}.') : L('A este ritmo, chegas lá em {d}.'), { d: etaLabel(f) });
  };
  const date = (iso: string) => new Date(iso).toLocaleDateString(s.language, { day: 'numeric', month: 'short', year: 'numeric' });

  // metas criadas à parte e, separadas, as que pertencem a uma conta
  const accGoals = (d?.goals ?? []).flatMap((x) => { const acc = (d?.accounts ?? []).find((a) => splitDesc(a.description).plan?.goalId === x.id); return acc ? [{ g: x, acc }] : []; });
  const ownGoals = (d?.goals ?? []).filter((x) => !accGoals.some((y) => y.g.id === x.id));
  const info = (x: Goal): GoalInfo => {
    const cur = currentOf(x), f = fc(x, cur);
    return { cur, r: x.targetCents > 0 ? Math.max(0, Math.min(1, cur / x.targetCents)) : 0, eta: etaLabel(f), per: f.etaMonths === null ? 0 : f.perMonthCents, done: x.targetCents > 0 && cur >= x.targetCents, when: deadlineInfo(x, cur), long: forecastLong(x, cur, (accGoals.find((y) => y.g.id === x.id)?.acc ?? (x.id.startsWith('acc:') ? d?.accounts.find((y) => y.id === x.id.slice(4)) : undefined))?.type === 'debt') };
  };
  const viaAcc = fromAcc && !left_ ? d?.accounts.find((x) => x.id === fromAcc) : undefined, viaPlan = viaAcc && splitDesc(viaAcc.description).plan;
  const viaGoal: Goal | undefined = viaAcc && (d?.goals.find((x) => x.id === viaPlan?.goalId) ?? { id: 'acc:' + viaAcc.id, name: viaAcc.name, targetCents: viaAcc.type === 'debt' ? Math.max(balOf(viaAcc), viaPlan?.startCents ?? viaAcc.initialBalanceCents) : 0, currentCents: 0, startDate: viaAcc.createdAt.slice(0, 10), targetDate: null, accountIds: [viaAcc.id], createdAt: viaAcc.createdAt, updatedAt: viaAcc.updatedAt, deletedAt: null });
  const g = viaGoal ?? d?.goals.find((x) => x.id === open);
  const gAcc = viaAcc ?? accGoals.find((y) => y.g.id === g?.id)?.acc;
  if (g && d) return (
    <>
      <GoalView g={g} acc={gAcc} info={info(g)} accounts={d.accounts} extra={gAcc?.type === 'debt' ? <DebtBoost key={gAcc.id} a={gAcc} left={Math.max(0, balOf(gAcc))} txs={d.txs} accounts={d.accounts} transfers={d.transfers} balOf={balOf} money={money} lang={s.language} reload={reload} /> : gAcc ? <section className="mv-card gl-sec"><h2>{L('Dinheiro que entrou')}</h2><PaymentList a={gAcc} transfers={d.transfers} txs={d.txs} accounts={d.accounts} money={money} lang={s.language} short={8} /></section> : undefined} valueOf={(a) => goalValueCents(a, balOf(a))} money={money} date={date} onBack={() => { if (viaGoal) { setLeft(true); navigate('/contas'); } else setOpen(null); }} onEdit={() => setForm(true)} reload={reload} />
      {form && <NewGoal edit={g} current={currentOf(g)} accounts={d.accounts} balOf={balOf} money={money} onClose={() => setForm(false)} onDone={() => { setForm(false); reload(); }} />}
    </>
  );
  // total juntado: cada conta conta uma só vez, mesmo que sirva para várias metas
  const saveGoals = (d?.goals ?? []).filter((x) => !accGoals.some((y) => y.g.id === x.id && y.acc.type === 'debt'));
  const usedAccs = new Set(saveGoals.flatMap((x) => x.accountIds ?? []));
  const savedTotal = saveGoals.reduce((a, x) => a + (x.accountIds?.length ? 0 : x.currentCents), 0) + (d?.accounts ?? []).filter((a) => usedAccs.has(a.id)).reduce((a, x) => a + goalValueCents(x, balOf(x)), 0);
  const aim = saveGoals.reduce((a, x) => a + x.targetCents, 0), doneN = (d?.goals ?? []).filter((x) => info(x).done).length;

  return (
    <div className="fx-page mv sh">
      <header className="mv-head"><h1 className="sh-title">{L('Metas')}</h1></header>
      {d && ownGoals.length === 0 && accGoals.length === 0 && <EmptyState icon="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM12 12h.01" title={L('Ainda não tens metas')} text={L('Uma meta é um objetivo para juntar dinheiro. A app mostra quanto falta e quando lá chegas.')} examples={['🏖️ Férias', '🚗 Carro', '🛟 Emergências', '🏠 Casa']} />}
      {(d?.goals.length ?? 0) > 1 && aim > 0 && <section className="mv-hero sh-hero gl-total">
        <small className="mv-hero-label">{L('Já juntaste nas tuas metas')}</small>
        <strong className={'mv-balance ' + (savedTotal < 0 ? 'fx-neg' : 'fx-pos')}>{money(savedTotal)}</strong>
        <span className="gl-total-sub">{L('de')} {money(aim)}{doneN > 0 && <em>✓ {doneN} {doneN === 1 ? L('concluída') : L('concluídas')}</em>}</span>
        <div className="sh-bar"><i style={{ width: `${Math.max(0, Math.min(1, savedTotal / aim)) * 100}%` }} /></div>
      </section>}
      {ownGoals.length > 0 && accGoals.length > 0 && <div className="goal-sec gl-part"><h2><span className="pco-mic"><Ic d="M6 21V4h11l-2 4 2 4H6" size={18} /></span>{L('As tuas metas')}</h2></div>}
      {ownGoals.length > 0 && <div className="gl-grid">{ownGoals.map((x, i) => <GoalCard key={x.id} g={x} info={info(x)} money={money} i={i} onOpen={() => setOpen(x.id)} />)}</div>}
      {accGoals.length > 0 && <div className={'goal-sec gl-part' + (ownGoals.length > 0 ? ' line' : '')}><h2><span className="pco-mic"><Ic d={ICON.wallet} size={18} /></span>{L('Das tuas contas')}</h2></div>}
      {accGoals.length > 0 && <div className="gl-grid">{accGoals.map(({ g: x, acc }, i) => <GoalCard key={x.id} g={x} acc={acc} icon={TYPE_IC[acc.type]} info={info(x)} money={money} i={i} onOpen={() => setOpen(x.id)} />)}</div>}
<button type="button" className="sh-pill" onClick={() => setForm(true)}><Ic d={ICON.plus} size={16} />{L('Criar meta')}</button>
      {form && <NewGoal accounts={d?.accounts ?? []} balOf={balOf} money={money} onClose={() => setForm(false)} onDone={() => { setForm(false); reload(); }} />}
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
  const [recs, setRecs] = useState<Recurring[]>([]);
  useEffect(() => { loadAll().then(setD).catch(() => {}); db.recurrings.toArray().then((x) => setRecs(live(x))).catch(() => {}); }, []);

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
    const label = `${L('Em comparação com')} ${prevName}`;
    return (
      <span className="sh-trend-box">
        <button type="button" className={'sh-trend ' + tone} aria-label={`${pctv > 0 ? L('Mais') : pctv < 0 ? L('Menos') : L('Igual')} ${Math.abs(pctv)}%. ${label}`}
          onClick={(e) => { e.stopPropagation(); setTip(tip === id ? null : id); }}>
          {cmpShort(t, pctv)}
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
            {m.income > 0 && <div className="sh-line"><span>{L('Poupaste')}</span><b className={bal < 0 ? 'fx-neg' : 'fx-pos'}>{Math.round((bal / m.income) * 100)}% {L('dos rendimentos')}</b></div>}
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
  // pagamentos recorrentes e subscrições deste mês/ano, e o que se podia ter poupado com os que não são essenciais
  const recEl = (() => {
    if (!d) return null;
    const { added, found } = allPayments(d.txs, recs, ignoredList());
    const from = pref + (yearly ? '-01-01' : '-01'), to = yearly ? pref + '-12-31' : `${pref}-${String(days).padStart(2, '0')}`;
    const list = [...added, ...(hasFeature('subscriptions') ? found : [])].map((p) => { const v = inPeriod(p, from, to); const now_ = !yearly && (cur.y > now.getFullYear() || isNow); return { p, cents: v.paid + v.due || (now_ ? p.monthlyCents : 0) }; }).filter((x) => x.cents > 0); // no mês atual conta também o que é habitual
    if (!list.length) return null;
    const total = list.reduce((a, x) => a + x.cents, 0), free = list.filter((x) => !isEssential(x.p, catOf(x.p.categoryId))).reduce((a, x) => a + x.cents, 0);
    const share = Math.min(1, m.expense > 0 ? total / Math.max(total, m.expense) : 1);
    return (
      <Link to="/subscricoes" className="mv-card rs-card">
        <span className="rs-head"><span className="pco-mic"><Ic d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" size={18} /></span><b>{L('Recorrentes e subscrições')}</b><Ic d={ICON.right} size={16} /></span>
        <span className="rs-main"><GoalRing r={share} size={92}><b>{Math.round(share * 100)}%</b></GoalRing>
          <span className="rs-vals"><small>{yearly ? L('Gasto no ano') : L('Gasto no mês')}</small><strong className="fx-neg"><CountMoney cents={total} money={money} /></strong>
            <em>{yearly ? fill(L('{m} por mês'), { m: money(Math.round(total / 12)) }) : fill(L('{m} por dia'), { m: money(Math.round(total / days)) })}</em></span></span>
        {free > 0 && <span className="rs-save"><Ic d="M12 5v14M5 12l7 7 7-7" size={15} /><span>{L('Podias ter poupado')}</span><b className="fx-pos">{money(free)}</b></span>}
      </Link>
    );
  })();
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

      {d && m.rows.length === 0 ? (<>
        {tab === 'sum' && bars.some((b) => b.income + b.expense > 0) && chartEl}
        <EmptyState icon="M4 20V10M10 20V4M16 20v-7M22 20H2" title={yearly ? L('Nada registado neste ano') : L('Nada registado neste mês')} text={L('Adiciona uma despesa ou um rendimento e vês aqui para onde vai o teu dinheiro.')} />
        <button type="button" className="sh-btn in" onClick={() => openTxForm({ type: 'expense' })}><Ic d={ICON.plus} size={18} />{L('Adicionar despesa')}</button>
      </>) : tab === 'sum' ? (
        <>
          {chartEl}
          {totalsEl}
          {linesEl}
          {recEl}
          {yearly ? yearCal() : monthCal()}
        </>
      ) : catsEl}
    </div>
  );
}
