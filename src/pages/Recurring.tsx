// Recorrentes: subscrições e pagamentos que se repetem. Mostra quanto pesam, encontra os que ainda não estão adicionados
// e faz as contas a quanto se podia poupar. Aviso (RecurringPopup): pergunta se a pessoa quer adicionar um que se repete.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Category, Recurring, RecurringFrequency, Transaction } from '../db/database';
import { activeCategories, addRecurring, advanceDate, materializeDueRecurrings, RECURRING_FREQUENCIES } from '../core/finance';
import { allPayments, inPeriod, isEssential, isoDay, nextFrom, payKey, serviceOf, type Payment, type ServiceKind } from '../core/payments';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { SIMPLE_UI } from '../core/uiMode';
import { fill } from '../ui/AccountPlan';
import { appConfirm } from '../ui/confirm';
import { CountMoney } from '../ui/CountMoney';
import { DatePicker } from '../ui/DatePicker';
import { EmptyState } from '../ui/EmptyState';
import { AmountField, CategoryRow, DateRow, FI, Row, SwitchRow, TextRow } from '../ui/formFields';
import { CatIcon, catLabel, Ic, ICON, PickMenu } from '../ui/fx';
import { GoalRing } from '../ui/GoalRing';
import { useMissing } from '../ui/missing';
import { initialPeriod, PeriodFilter, periodRange, type Period } from '../ui/PeriodFilter';
import { guiding } from '../ui/Guide';
import { openTxForm, useTxSaved } from '../ui/TxForm';
import { L } from '../i18n/phrases';
import { usePlan } from './Premium';
import { BottomSheet } from './SimplePages';
import { CALENDAR, GTile } from './Split';

const REPEAT = 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3';
const KIND: Record<ServiceKind, () => string> = {
  stream: () => L('Filmes e séries'), music: () => L('Música'), games: () => L('Jogos'), cloud: () => L('Apps e nuvem'), gym: () => L('Ginásio'), phone: () => L('Telemóvel e internet'),
  energy: () => L('Luz e gás'), water: () => L('Água'), insurance: () => L('Seguro'), home: () => L('Casa'), loan: () => L('Crédito'), news: () => L('Notícias'), shop: () => L('Compras'),
};
const REC_CHANGED = 'wallet:rec-changed';
const changed = () => { window.dispatchEvent(new Event(REC_CHANGED)); };
const key = () => 'wallet.recIgnored.' + db.name;
export const ignoredList = (): string[] => { try { return JSON.parse(localStorage.getItem(key()) || '[]') as string[]; } catch { return []; } };
const ignore = (k: string) => { try { localStorage.setItem(key(), JSON.stringify([...new Set([...ignoredList(), k])])); } catch { /* sem storage */ } changed(); };

/** Passa um pagamento detetado a recorrente (começa na próxima data, nunca numa já passada). */
async function adopt(p: Payment) {
  const today = isoDay(new Date()), first = nextFrom(p);
  const next = p.hits.some((h) => h.date === first) ? advanceDate(first, p.frequency) : first; // já registado nesse dia: o automático começa no seguinte
  const rec = { type: 'expense' as const, categoryId: p.categoryId, description: p.name, amountCents: p.cents, currency: loadSettings().currency, frequency: p.frequency, nextDate: next, endDate: null, accountId: p.accountId };
  await addRecurring(db, rec);
  await materializeDueRecurrings(db, today);
  changed();
}

function usePayments() {
  const { has } = usePlan();
  const [d, setD] = useState<{ txs: Transaction[]; recs: Recurring[]; cats: Category[]; ignored: string[] } | null>(null);
  const load = () => { Promise.all([db.transactions.toArray(), db.recurrings.toArray(), activeCategories(db)]).then(([txs, recs, cats]) => setD({ txs: txs.filter((t) => t.deletedAt === null), recs: recs.filter((r) => r.deletedAt === null), cats, ignored: ignoredList() })).catch(() => {}); };
  useEffect(() => { load(); window.addEventListener(REC_CHANGED, load); return () => window.removeEventListener(REC_CHANGED, load); }, []);
  useTxSaved(load);
  const can = has('subscriptions');
  const { added, found } = useMemo(() => (d ? allPayments(d.txs, d.recs, d.ignored) : { added: [], found: [] }), [d]);
  return { d, added, found: can ? found : [], hidden: can ? 0 : found.length, load };
}

export function RecurringPage() {
  const { t } = useTranslation();
  const s = loadSettings(), money = (c: number) => formatMoney(c, s.currency, s.language);
  const { d, added, found, hidden } = usePayments();
  const [per, setPer] = useState<Period>(() => initialPeriod());
  const [edit, setEdit] = useState<Payment | null>(null);
  const [off, setOff] = useState<Record<string, boolean>>({}); // simulação: pagamentos a libertar
  const catOf = (id: string) => d?.cats.find((c) => c.id === id);
  const all = [...added, ...found], range = periodRange(per);
  const sums = all.map((p) => inPeriod(p, range.from, range.to)), paid = sums.reduce((a, x) => a + x.paid, 0), due = sums.reduce((a, x) => a + x.due, 0);
  const spent = (d?.txs ?? []).filter((x) => x.type === 'expense' && x.date >= range.from && x.date <= range.to).reduce((a, x) => a + x.amountCents, 0);
  const base = spent + due, ratio = base > 0 ? (paid + due) / base : 0, month = all.reduce((a, p) => a + p.monthlyCents, 0);
  const freed = (p: Payment) => off[p.key] ?? !isEssential(p, catOf(p.categoryId));
  const save = all.filter(freed).reduce((a, p) => a + p.monthlyCents, 0);
  const when = (n: number) => (n < 0 ? L('Em atraso') : n === 0 ? L('Hoje') : n === 1 ? L('Amanhã') : fill(L('Daqui a {d} dias'), { d: String(n) }));
  const kindOf = (p: Payment) => { const k = serviceOf(p.name); const c = catOf(p.categoryId); return k ? KIND[k.kind]() : c ? catLabel(t, c) : ''; };
  const title = (p: Payment) => p.name || (catOf(p.categoryId) ? catLabel(t, catOf(p.categoryId)!) : L('Pagamento'));
  const card = (p: Payment, i: number) => (
    <button type="button" key={p.recId ?? p.key} className="mv-card gl-card rc-card" style={{ '--i': i } as CSSProperties} onClick={() => setEdit(p)}>
      <span className="rc-ic"><CatIcon cat={catOf(p.categoryId) ?? {}} size={54} /></span>
      <span className="gl-main"><b className="gl-name">{title(p)}</b><span className="gl-money">{kindOf(p)} · {t('goals.' + p.frequency)}</span><span className="gl-chips"><em className={p.daysUntil <= 3 ? 'due' : ''}><Ic d={CALENDAR} size={13} />{when(p.daysUntil)}</em></span></span>
      <span className="rc-val"><b className="fx-neg">−{money(p.cents)}</b><small>{money(p.monthlyCents * 12)}/{L('ano')}</small></span>
    </button>
  );
  return (
    <div className="fx-page mv sh rc-page">
      <header className="mv-head"><h1 className="sh-title">{L('Recorrentes')}</h1></header>
      <PeriodFilter value={per} onChange={setPer} />
      {all.length > 0 && <>
        <section className="mv-hero sh-hero gl-hero lm-sum rc-hero">
          <GoalRing r={Math.min(1, ratio)} size={176}><b>{Math.round(ratio * 100)}%</b><small>{L('dos teus gastos')}</small></GoalRing>
          <div className="gl-have"><small>{L('Pagamentos que se repetem')}</small><b className="fx-neg"><CountMoney cents={paid + due} money={money} /></b>
            {due > 0 && <small>{fill(L('ainda vão sair {m}'), { m: money(due) })}</small>}</div>
        </section>
        <div className="gx-tiles lm-tiles">
          <GTile d={CALENDAR} label={L('Por mês')} value={money(month)} />
          <GTile d="M4 20V10M10 20V4M16 20v-7M22 20H2" label={L('Por ano')} value={money(month * 12)} />
          <GTile d={REPEAT} label={L('Pagamentos')} value={String(all.length)} />
        </div>
      </>}
      {found.length > 0 && <section className="rc-sec">
        <h2><span className="pco-mic"><Ic d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" size={18} /></span>{L('Encontrámos estes')}</h2>
        <div className="gl-grid">{found.map((p, i) => (
          <div key={p.key} className="mv-card rc-found" style={{ '--i': i } as CSSProperties}>
            <span className="rc-ic"><CatIcon cat={catOf(p.categoryId) ?? {}} size={50} /></span>
            <span className="gl-main"><b className="gl-name">{title(p)}</b><span className="gl-money">{money(p.cents)} · {t('goals.' + p.frequency)}</span></span>
            <span className="rc-btns"><button type="button" className="rc-no" onClick={() => ignore(p.key)} aria-label={`${L('Não é recorrente')}: ${title(p)}`} title={L('Não é recorrente')}><Ic d={ICON.close} size={18} /></button><button type="button" className="rc-yes" onClick={() => { adopt(p).catch(() => {}); }}><Ic d={ICON.plus} size={17} />{L('Adicionar')}</button></span>
          </div>
        ))}</div>
      </section>}
      {hidden > 0 && <section className="mv-card rc-lock"><span className="gg-ic"><Ic d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" size={28} /></span><div><b>{fill(L('Encontrámos {d} pagamentos que se repetem'), { d: String(hidden) })}</b><small>{L('Vê-los e adicioná-los com um toque faz parte do Plus.')}</small></div><Link to="/plus" className="gl-act main">{L('Ver planos')}</Link></section>}
      {added.length > 0 && <section className="rc-sec">{found.length > 0 && <h2>{L('Os teus pagamentos')}</h2>}<div className="gl-grid">{added.map(card)}</div></section>}
      {d && all.length === 0 && hidden === 0 && <EmptyState icon={REPEAT} title={L('Sem pagamentos recorrentes')} text={L('Adiciona os que pagas todos os meses. A app também os encontra nas tuas despesas.')} examples={['🎬 Netflix', '🎵 Spotify', '💡 ' + L('Luz'), '🏠 ' + L('Renda')]} />}
      {all.length > 0 && <section className="mv-card gl-sec rc-save">
        <div className="rc-savehead"><div><h2>{L('Quanto podias poupar')}</h2><p className="gl-sub">{L('Toca no que podias deixar de pagar.')}</p></div><div className="rc-savenum"><b className="fx-pos"><CountMoney cents={save * 12} money={money} /></b><small>{L('por ano')}</small></div></div>
        <div className="rc-chips">{all.map((p) => <button key={p.recId ?? p.key} type="button" aria-pressed={freed(p)} className={freed(p) ? 'on' : ''} onClick={() => setOff((o) => ({ ...o, [p.key]: !freed(p) }))}><Ic d={freed(p) ? 'M20 6 9 17l-5-5' : ICON.plus} size={15} /><span>{title(p)}</span><b>{money(p.monthlyCents)}/{L('mês')}</b></button>)}</div>
      </section>}
      <button type="button" className="sh-pill" onClick={() => openTxForm({ type: 'expense', recurring: true })}><Ic d={ICON.plus} size={16} />{L('Novo recorrente')}</button>
      {edit && <EditSheet p={edit} cats={d?.cats ?? []} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditSheet({ p, cats, onClose }: { p: Payment; cats: Category[]; onClose: () => void }) {
  const { t } = useTranslation();
  const s = loadSettings();
  const [amt, setAmt] = useState((p.cents / 100).toFixed(2).replace('.', ',')), [name, setName] = useState(p.name), [cat, setCat] = useState(p.categoryId);
  const [freq, setFreq] = useState<RecurringFrequency>(p.frequency), [next, setNext] = useState(p.nextDate), [hasEnd, setHasEnd] = useState(!!p.endDate), [end, setEnd] = useState(p.endDate ?? '');
  const c = parseMoneyToCents(amt) ?? 0, missing = useMissing();
  const miss = missing([['v', L('o valor'), c > 0], ['cat', L('a categoria'), !!cat], ['next', L('a data'), !!next], ['end', L('a data limite'), !hasEnd || (!!end && end >= next)]]);
  const save = async () => {
    if (!miss.check() || !p.recId) return;
    await db.recurrings.update(p.recId, { amountCents: c, description: name.trim(), categoryId: cat, frequency: freq, nextDate: next, endDate: hasEnd ? end : null, updatedAt: new Date().toISOString() });
    await materializeDueRecurrings(db, isoDay(new Date()));
    changed(); onClose();
  };
  const stop = async () => {
    if (!p.recId || !(await appConfirm(L('Deixar de registar este pagamento? O que já foi pago continua nas transações.'), { ok: L('Sim'), danger: true }))) return;
    const n = new Date().toISOString();
    await db.recurrings.update(p.recId, { deletedAt: n, updatedAt: n });
    if (payKey(p.name)) ignore(payKey(p.name)); // não volta a ser sugerido
    changed(); onClose();
  };
  return (
    <BottomSheet title={L('Alterar recorrente')} onClose={onClose}>
      <div className="acc-form">
        {miss.note}
        <AmountField value={amt} onChange={setAmt} currency={s.currency} cls={miss.cls('v')} kind="expense" />
        <div className="tx-rows">
          <TextRow icon={FI.name} label={L('Nome')} value={name} onChange={setName} />
          <CategoryRow required cats={cats} kind="expense" value={cat} onChange={setCat} cls={miss.cls('cat')} />
          <Row div icon={FI.month} label={t('goals.frequency')}><PickMenu compact label={t('goals.frequency')} value={freq} options={RECURRING_FREQUENCIES.map((f) => ({ value: f, label: t('goals.' + f) }))} onChange={(v) => setFreq(v as RecurringFrequency)} /></Row>
          <DateRow label={L('Próximo pagamento')} value={next} onChange={setNext} cls={miss.cls('next')} />
          <SwitchRow icon={FI.date} cls={miss.cls('end')} label={hasEnd ? L('Data limite') : L('Tem data limite?')} on={hasEnd} onChange={setHasEnd}><DatePicker value={end} onChange={setEnd} className="fx-input tx-val" /></SwitchRow>
        </div>
        <button type="button" className="tx-addbtn" onClick={save}>{L('Guardar')}</button>
        <button type="button" className="gx-rm lm-del" onClick={stop}>{L('Parar este pagamento')}</button>
      </div>
    </BottomSheet>
  );
}

const LATER = 'wallet.recLater';
/** Repete-se e não está adicionado: pergunta se a pessoa quer adicionar (um de cada vez). */
export function RecurringPopup() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { d, found } = usePayments();
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem(LATER) === '1'; } catch { return false; } });
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = setTimeout(() => setReady(true), 2500); return () => clearTimeout(id); }, []); // só depois de a app assentar
  const s = loadSettings(), p = found.find((x) => x.sure);
  if (!SIMPLE_UI || !ready || later || guiding() || !p || pathname === '/subscricoes' || document.querySelector('.nt-pop:not(.rc-pop)')) return null;
  const c = d?.cats.find((x) => x.id === p.categoryId), name = p.name || (c ? catLabel(t, c) : '');
  return createPortal(
    <aside key={p.key} className="nt-pop rc-pop" role="dialog" aria-label={L('Pagamento que se repete')}>
      <div className="rc-poptop"><span className="rc-ic"><CatIcon cat={c ?? {}} size={52} /></span><div><small>{L('Pagamento que se repete')}</small><b>{name}</b><span>{formatMoney(p.cents, s.currency, s.language)} · {t('goals.' + p.frequency)}</span></div></div>
      <p>{L('Queres adicionar como pagamento recorrente?')}</p>
      <div className="rc-popbtns"><button type="button" className="no" onClick={() => ignore(p.key)}>{L('Não')}</button><button type="button" className="yes" onClick={() => { adopt(p).catch(() => {}); }}>{L('Adicionar')}</button></div>
      <button type="button" className="spi-later" onClick={() => { setLater(true); try { sessionStorage.setItem(LATER, '1'); } catch { /* sem storage */ } }}>{L('Decidir mais tarde')}</button>
    </aside>,
    document.body,
  );
}
