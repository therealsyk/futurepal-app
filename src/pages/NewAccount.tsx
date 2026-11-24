import { Hl } from './GoalView';
// Nova conta: o tipo em cima (Gastos | Poupança | Dívidas) e, conforme o tipo, o plano por mês, juros, data limite (cria a meta) e transferência.
import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db/app-db';
import type { Account, Goal } from '../db/database';
import { addTransfer, createAccount, updateAccount } from '../core/accounts';
import { activeCategories, addGoal, addRecurring, materializeDueRecurrings } from '../core/finance';
import { joinDesc, payoff, splitDesc, type DebtPlan } from '../core/debtPlan';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { todayISO } from '../core/dates';
import { milestone } from '../core/onboarding';
import { loadSettings } from '../core/settings';
import { DatePicker } from '../ui/DatePicker';
import { Ic, Seg } from '../ui/fx';
import { AccountRow, AmountField, DateRow, FI, SwitchRow, TextRow, onlyDigits as digits } from '../ui/formFields';
import { PC_MOBILE } from '../core/uiMode';
import { useMissing, type MissRule } from '../ui/missing';
import { L } from '../i18n/phrases';
import { fill } from '../ui/AccountPlan';
import { BottomSheet } from './SimplePages';

const cents = (v: string) => Math.abs(parseMoneyToCents(v || '0') ?? 0);

/** O que se pode mudar numa conta que já existe. */
export interface AccountEdit { balCents: number; name: string; desc: string; monthlyCents: number; rate: number; goal: boolean; end: string | null; targetCents: number; main: boolean; inNet: boolean }
const num = (c: number) => (c / 100).toFixed(2).replace('.', ',');

export function NewAccount({ initial, accounts, balOf, endText, onClose, onDone, edit, preset, presetMonthly }: {
  presetMonthly?: string; // cêntimos sugeridos pelo Planeamento ('0' = pausar a poupança automática)
  preset?: { monthly: string; name?: string; bal?: string }; // vindo da 1.ª conta de gastos: poupança com valor fixo por mês já preenchido
  edit?: { acc: Account; goal?: Goal; onSave: (e: AccountEdit) => Promise<void>; onDelete?: () => void };
  initial: Account['type']; accounts: Account[]; balOf: (a: Account) => number; money?: (c: number) => string; endText: (months: number) => string;
  onClose: () => void; onDone: (kind: Account['type'], next?: { saveMonthly: string }) => void;
}) {
  const s = loadSettings();
  const cur = edit?.acc.currency ?? s.currency;
  const money = (c: number) => formatMoney(c, cur, s.language);
  const [kind, setKind] = useState<Account['type']>(initial);
  const was = splitDesc(edit?.acc.description), wasM = was.plan?.monthlyCents ?? 0, wasR = was.plan?.rate ?? 0, g0 = edit?.goal;
  const [bal, setBal] = useState(edit ? num(balOf(edit.acc)) : preset?.bal ?? ''), [name, setName] = useState(edit?.acc.name ?? preset?.name ?? ''), [desc, setDesc] = useState(was.text);
  const pm = presetMonthly !== undefined ? Number(presetMonthly) : null;
  const [hasMonthly, setHasMonthly] = useState(pm !== null ? pm > 0 : wasM > 0 || !!preset?.monthly), [monthly, setMonthly] = useState(pm ? num(pm) : wasM ? num(wasM) : preset?.monthly ?? '');
  // primeira conta de gastos: quer poupar um valor certo por mês? (depois abre a criação da poupança)
  const firstSpending = !edit && accounts.filter((a) => a.type === 'spending').length <= 1;
  const [wantSave, setWantSave] = useState(false), [saveAmt, setSaveAmt] = useState('');
  const [hasRate, setHasRate] = useState(wasR > 0), [rate, setRate] = useState(wasR ? String(wasR).replace('.', ',') : '');
  const [hasEnd, setHasEnd] = useState(!!g0?.targetDate), [end, setEnd] = useState(g0?.targetDate?.slice(0, 10) ?? '');
  const [wantGoal, setWantGoal] = useState(!!g0), [target, setTarget] = useState(g0 && initial !== 'debt' ? num(g0.targetCents) : '');
  const [how, setHow] = useState<'hand' | 'transfer'>('hand');
  const [from, setFrom] = useState(''), [amount, setAmount] = useState<string | null>(null), [date, setDate] = useState(todayISO()), [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [main, setMain] = useState(edit?.acc.isDefault ?? false), [inNet, setInNet] = useState(edit?.acc.includeInNetWorth ?? true);

  const debt = kind === 'debt', plan = kind !== 'spending', start = cents(bal);
  const m = plan && hasMonthly ? cents(monthly) : 0, r = debt && hasRate ? Number(rate.replace(',', '.')) || 0 : 0;
  const goal = plan && wantGoal, transfer = plan && !edit && how === 'transfer';
  const now = new Date(), e = hasEnd && end ? new Date(end + 'T00:00:00') : null;
  const monthsLeft = e ? Math.max(1, (e.getFullYear() - now.getFullYear()) * 12 + e.getMonth() - now.getMonth()) : 0;
  const auto = m && monthsLeft ? start + m * monthsLeft : 0; // objetivo, se disser quanto por mês e até quando
  const goalCents = debt ? start : cents(target) || auto;
  const sources = accounts.filter((a) => a.type !== 'debt' && a.currency === s.currency);
  const src = from || sources.find((a) => a.isDefault)?.id || sources[0]?.id || '';
  const amt = amount ?? monthly, po = debt ? payoff(start, m, r) : null;

  const missing = useMissing();
  const first: MissRule[] = [
    ['bal', debt ? L('quanto deves') : '', !debt || !!edit || start > 0], ['name', L('o nome'), !!name.trim()],
    ['monthly', debt ? L('quanto abater por mês') : L('quanto juntar por mês'), !plan || (!hasMonthly && !r) || m > 0],
    ['rate', L('os juros'), !debt || !hasRate || r > 0],
    ['low', L('um valor por mês maior do que os juros'), !debt || !r || !m || !!po],
  ];
  const second: MissRule[] = [
    ['end', L('a data limite'), !plan || !hasEnd || !!end], ['target', L('quanto queres juntar no total'), !goal || goalCents > 0],
    ['from', L('a conta de onde sai o dinheiro'), !transfer || !!src], ['amount', L('quanto transferir'), !transfer || cents(amt) > 0],
  ];
  const miss = missing([...first, ...second]);
  const pickKind = (k: Account['type']) => { setKind(k); miss.reset(); };

  // poupança automática a partir da 1.ª conta de gastos
  const [askSave, setAskSave] = useState(false), [saveHow, setSaveHow] = useState<'hand' | 'transfer'>('transfer');
  const [sFrom, setSFrom] = useState('new'), [sAmt, setSAmt] = useState(''), [sDate, setSDate] = useState(todayISO()), [sRep, setSRep] = useState(true);
  const wantsSaving = kind === 'spending' && firstSpending && wantSave && cents(saveAmt) > 0;
  const [askBal, setAskBal] = useState(false), [balOk, setBalOk] = useState(false), [skipSave, setSkipSave] = useState(false);
  const oddBal = !edit && kind !== 'debt' && start > 0 && (kind === 'savings' || start >= 1000000 || (goal && start >= goalCents));
  const create = async (noSave = false, okBal = false) => {
    if (!miss.check() || busy) return;
    if (oddBal && !balOk && !okBal) { setAskBal(true); return; }
    const withSave = wantsSaving && !noSave && !skipSave;
    if (withSave && !askSave) { setSAmt(saveAmt); setAskSave(true); return; }
    setBusy(true);
    try {
      if (edit) { await edit.onSave({ balCents: parseMoneyToCents(bal || '0') ?? 0, name: name.trim(), desc, monthlyCents: m, rate: r, goal, end: hasEnd && end ? end : null, targetCents: goalCents, main: kind === 'spending' && main, inNet }); return; }
      const p: DebtPlan | null = plan ? { monthlyCents: m, startCents: start, rate: r || undefined } : null;
      milestone('account');
      const acc = await createAccount(db, { name: name.trim(), description: joinDesc(desc, p), type: kind, currency: s.currency, initialBalanceCents: start, includeInNetWorth: inNet, isDefault: kind === 'spending' && main, showOnHome: true });
      if (goal && p) { // a meta de sempre, ligada à conta: o valor vem do saldo (na dívida, do que já foi abatido)
        const g = await addGoal(db, name.trim(), goalCents, todayISO(), e ? end : null);
        await db.goals.update(g.id, { notes: desc.trim() || undefined, accountIds: [acc.id] });
        await updateAccount(db, acc.id, { description: joinDesc(desc, { ...p, goalId: g.id }) });
      }
      if (transfer) {
        if (recurring) {
          const cat = (await activeCategories(db))[0]?.id ?? '';
          const last = debt && po && cents(amt) === m ? new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + po.months - 1, Number(date.slice(8))) : null;
          const lastIso = last ? `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}` : null;
          await addRecurring(db, { type: 'expense', categoryId: cat, description: name.trim(), amountCents: cents(amt), currency: s.currency, frequency: 'monthly', nextDate: date, endDate: lastIso ?? (e && end >= date ? end : null), accountId: src, toAccountId: acc.id });
          await materializeDueRecurrings(db, todayISO());
        } else await addTransfer(db, { fromAccountId: src, toAccountId: acc.id, amountCents: cents(amt), date, note: name.trim(), categoryId: null });
      }
      if (withSave) { // a conta de poupança nasce já com o valor por mês e, se a pessoa quiser, a transferência
        const sv = await createAccount(db, { name: L('Poupanças'), description: joinDesc('', { monthlyCents: cents(saveAmt), startCents: 0 }), type: 'savings', currency: s.currency, initialBalanceCents: 0, includeInNetWorth: true, isDefault: false, showOnHome: true });
        if (saveHow === 'transfer' && cents(sAmt) > 0) {
          const fromId = sFrom === 'new' ? acc.id : sFrom;
          if (sRep) {
            const cat = (await activeCategories(db))[0]?.id ?? '';
            await addRecurring(db, { type: 'expense', categoryId: cat, description: L('Poupança do mês'), amountCents: cents(sAmt), currency: s.currency, frequency: 'monthly', nextDate: sDate, endDate: null, accountId: fromId, toAccountId: sv.id });
            await materializeDueRecurrings(db, todayISO());
          } else await addTransfer(db, { fromAccountId: fromId, toAccountId: sv.id, amountCents: cents(sAmt), date: sDate, note: L('Poupança do mês'), categoryId: null });
        }
        setAskSave(false);
      }
      onDone(kind);
    } finally { setBusy(false); }
  };

  const numIn = (v: string, set: (v: string) => void, hint: string) => <input className="tx-val" inputMode="decimal" value={v} placeholder={hint} onChange={(x) => set(digits(x.target.value))} />;
  const src2 = accounts.find((a) => a.id === src);
  const est = !debt && hasMonthly && m > 0 && goal && goalCents > start ? (() => {
    const n = Math.ceil((goalCents - start) / m), dt = new Date(now.getFullYear(), now.getMonth() + n, 1);
    const late = !!(hasEnd && end && dt > new Date(end + 'T23:59:59'));
    return { when: dt.toLocaleDateString(s.language, { month: 'long', year: 'numeric' }), late, need: monthsLeft ? Math.ceil((goalCents - start) / monthsLeft) : 0 };
  })() : null;
  const need = !hasMonthly && e && goalCents > 0 ? Math.ceil(Math.max(0, goalCents - (debt ? 0 : start)) / monthsLeft) : 0;

  const amtLabel = edit ? (debt ? L('Quanto deves agora') : L('Quanto tem agora')) : debt ? L('Quanto deves') : L('Saldo inicial');
  const partA = <>
    <AmountField signed={!!edit} value={bal} onChange={setBal} currency={cur} label={amtLabel} cls={miss.cls('bal')} autoFocus={PC_MOBILE && !edit} />
    <div className="tx-rows">
      <TextRow icon={FI.name} label={L('Nome da conta')} value={name} onChange={setName} cls={miss.cls('name')} placeholder={debt ? L('Ex.: Empréstimo da casa') : kind === 'savings' ? L('Ex.: Poupanças') : L('Ex.: Conta do banco')} />
      <TextRow label={L('Descrição')} value={desc} onChange={setDesc} />
      {kind === 'spending' && !edit?.acc.isDefault && <SwitchRow icon="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" label={L('Tornar esta a conta principal?')} sub={main ? undefined : L('As despesas e rendimentos novos vão para esta conta')} on={main} onChange={setMain} />}
      {kind === 'spending' && edit?.acc.isDefault && <div className="tx-row acc-mainrow"><span><Ic d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" size={18} /><span className="acc-lbl">{L('Esta é a tua conta principal')}</span></span></div>}
      {kind === 'spending' && firstSpending && <SwitchRow icon="M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2z" label={wantSave ? L('Quanto queres poupar por mês?') : L('Contas poupar um valor por mês?')} sub={wantSave ? L('Criamos também uma conta de poupança com este valor') : L('Criamos também a conta de poupança, para veres quanto juntas')} on={wantSave} onChange={setWantSave}>{numIn(saveAmt, setSaveAmt, L('Ex.: 200'))}</SwitchRow>}
      <SwitchRow icon="M3 17l6-6 4 4 8-8M14 7h7v7" label={L('Contar para o património líquido?')} sub={inNet ? undefined : L('Fica de fora do total do que tens menos o que deves')} on={inNet} onChange={setInNet} />
      {plan && <>
        <SwitchRow icon={FI.month} cls={miss.cls('monthly') || miss.cls('low')} label={hasMonthly ? (debt ? L('Abater por mês') : L('Juntar por mês')) : debt ? L('Abater um valor certo por mês?') : L('Juntar um valor certo por mês?')}
          sub={hasMonthly ? undefined : debt ? L('Se não, vais abatendo quando puderes') : L('Se não, vais juntando quando puderes')} on={hasMonthly} onChange={(v) => { setHasMonthly(v); if (!v) setHasRate(false); }}>{numIn(monthly, setMonthly, L('Ex.: 500'))}</SwitchRow>
        {debt && <SwitchRow icon={FI.pct} cls={miss.cls('rate')} label={hasRate ? L('Juros por ano (%)') : L('Tem juros?')} on={hasRate} onChange={(v) => { setHasRate(v); if (v) setHasMonthly(true); }}>{numIn(rate, setRate, L('Ex.: 3,5'))}</SwitchRow>}
      </>}
    </div>
  </>;
  const partB = plan && <>
    <div className="tx-rows">
      <SwitchRow icon={FI.date} cls={miss.cls('end')} label={hasEnd ? L('Data limite') : L('Tem data limite?')} sub={hasEnd ? undefined : L('Esta conta passa a mostrar se vais a tempo')} on={hasEnd} onChange={(v) => { setHasEnd(v); if (v) setWantGoal(true); }}><DatePicker value={end} onChange={setEnd} className="fx-input tx-val" /></SwitchRow>
      {debt && !g0 && <SwitchRow icon={FI.track} label={L('Acompanhar esta dívida?')} sub={L('Mostra quanto falta, dentro da própria conta')} on={wantGoal} onChange={(v) => { setWantGoal(v); if (!v) setHasEnd(false); }} />}
      {!debt && <SwitchRow icon={FI.target} cls={miss.cls('target')} label={wantGoal ? L('Juntar até') : L('Juntar até um valor?')} sub={wantGoal ? undefined : L('Ex.: 5000 € para um fundo de emergência')} on={wantGoal} onChange={(v) => { setWantGoal(v); if (!v) setHasEnd(false); }}>{numIn(target, setTarget, auto ? money(auto) : L('Ex.: 5000'))}</SwitchRow>}
    </div>
    {!edit && <><h3 className="acc-how">{debt ? L('Como queres pagar?') : L('Como queres juntar?')}</h3>
    <div className="tx-seg"><Seg value={how} onChange={setHow} label={debt ? L('Como queres pagar?') : L('Como queres juntar?')} options={[{ id: 'hand', label: L('Registar à mão') }, { id: 'transfer', label: L('Transferir de outra conta') }]} /></div></>}
    {transfer && <div className="tx-rows">
      <AccountRow label={L('Da conta')} cls={miss.cls('from')} value={src} options={sources.map((a) => ({ id: a.id, name: a.name, sub: a.type === 'savings' ? L('Poupança') : L('Gastos'), right: money(balOf(a)) }))} balance={src2 && money(balOf(src2))} onChange={setFrom} />
      <TextRow icon={FI.money} money label={L('Valor a transferir')} value={amt} onChange={setAmount} placeholder="0" cls={miss.cls('amount')} />
      <DateRow label={recurring ? L('A primeira em') : L('Data')} value={date} onChange={setDate} />
      <SwitchRow icon={FI.month} label={L('Repetir todos os meses')} on={recurring} onChange={setRecurring} />
    </div>}
    {debt && po && m > 0 && start > 0 && <div className="debt-sum">
      {r > 0 && <div className="acc-sum3"><p><span>{L('Sem juros')}</span><b>{money(start)}</b></p><p><span>{L('Com juros')}</span><b>{money(po.totalCents)}</b></p><p><span>{L('Só de juros')}</span><b className="fx-neg">{money(po.totalCents - start)}</b></p></div>}
      <p className="debt-prev">{endText(po.months)}</p>
    </div>}
    {!debt && est && <div className={'nac-est' + (est.late ? ' late' : '')}>
      <span className="nac-est-ic"><Ic d="M3 17l6-6 4 4 8-8M14 7h7v7" size={18} /></span>
      <div><small>{L('Estimativa')}</small><p><Hl text={fill(L('Juntando {m} por mês, chegas aos {t} em {d}.'), { m: money(m), t: money(goalCents), d: est.when })} /></p>
        {hasEnd && end && <em>{est.late ? fill(L('Depois da data limite: precisavas de {n} por mês.'), { n: money(est.need) }) : L('Chegas antes da data limite ✓')}</em>}</div>
    </div>}
    {need > 0 && <p className="debt-prev">{fill(debt ? L('Para acabar a tempo precisas de abater cerca de {m} por mês') : L('Para lá chegares a tempo precisas de juntar cerca de {m} por mês'), { m: money(need) })}</p>}
  </>;
  return (
    <BottomSheet title={edit ? L('Alterar conta') : L('Nova conta')} onClose={onClose}>
      <div className="acc-form">
        {miss.note}
        {!edit && <div className="tx-seg acc-kind"><Seg value={kind} onChange={pickKind} label={L('Tipo de conta')} options={[{ id: 'spending', label: L('Gastos') }, { id: 'savings', label: L('Poupança') }, { id: 'debt', label: L('Dívidas') }]} /></div>}
        {partA}
        {partB}
        <button type="button" className="tx-addbtn" disabled={busy} onClick={() => create()}>{edit ? L('Guardar') : L('Criar conta')}</button>
        {askBal && createPortal(<div className="spi-back nsv-back" onMouseDown={(e2) => { if (e2.target === e2.currentTarget) setAskBal(false); }}>
          <section className="spi-card nsv-card" role="dialog" aria-modal="true" aria-label={L('Confirmar saldo inicial')}>
            <span className="nsv-ic warn" aria-hidden="true"><Ic d="M12 8v5M12 16h.01M12 3l9 16H3z" size={26} /></span>
            <h2>{L('Começar esta conta com')} <span className="nsv-val">{money(start)}</span>?</h2>
            <p>{L('O saldo inicial é o dinheiro que já está nesta conta hoje.')}{kind === 'savings' ? ' ' + L('Se querias dizer quanto queres juntar, usa "Juntar até um valor".') : ''}</p>
            <div className="nsv-acts"><button type="button" className="gl-act" onClick={() => setAskBal(false)}>{L('Corrigir')}</button><button type="button" className="gl-act ok" onClick={() => { setAskBal(false); setBalOk(true); create(false, true); }}>{fill(L('Sim, já tenho {m}'), { m: money(start) })}</button></div>
          </section></div>, document.body)}
        {askSave && createPortal(<div className="spi-back nsv-back" onMouseDown={(e2) => { if (e2.target === e2.currentTarget && !busy) setAskSave(false); }}>
          <section className="spi-card nsv-card" role="dialog" aria-modal="true" aria-label={L('Criamos também a tua conta de poupança')}>
            <span className="nsv-ic" aria-hidden="true"><Ic d="M19 7h-1V5a3 3 0 0 0-6 0v2H5v13h14zM14 5a1 1 0 0 1 2 0v2h-2z" size={26} /></span>
            <h2>{L('Criamos também a tua conta de poupança')}</h2>
            <p>{L('Disseste que queres poupar')} <span className="nsv-val">{money(cents(saveAmt))}</span> {L('por mês.')}</p>
            <ul className="nsv-why">
              <li style={{ '--i': 0 } as CSSProperties}><span><Ic d="M3 17l6-6 4 4 8-8M14 7h7v7" size={15} /></span>{L('Vês quanto já juntaste, mês a mês')}</li>
              <li style={{ '--i': 1 } as CSSProperties}><span><Ic d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" size={15} /></span>{L('Não gastas sem querer o que é para poupar')}</li>
              <li style={{ '--i': 2 } as CSSProperties}><span><Ic d="M7 7h12l-3-3M17 17H5l3 3" size={15} /></span>{L('Pode encher-se sozinha todos os meses')}</li>
            </ul>
            <b className="nsv-q">{L('Como queres juntar?')}</b>
            <div className="nsv-opts">
              <button type="button" className={saveHow === 'transfer' ? 'on' : ''} onClick={() => setSaveHow('transfer')}><Ic d="M7 7h12l-3-3M17 17H5l3 3" size={20} /><span><b>{L('Transferir de outra conta')}</b><small>{L('O dinheiro passa sozinho, por exemplo da conta de gastos')}</small></span></button>
              <button type="button" className={saveHow === 'hand' ? 'on' : ''} onClick={() => setSaveHow('hand')}><Ic d="M12 5v14M5 12h14" size={20} /><span><b>{L('Registar à mão')}</b><small>{L('Vais registando quando puseres dinheiro de lado')}</small></span></button>
            </div>
            {saveHow === 'transfer' && <div className="tx-rows nsv-rows">
              <AccountRow label={L('Da conta')} value={sFrom} options={[{ id: 'new', name: name.trim() || L('Esta conta nova'), sub: L('A conta que estás a criar'), right: money(start) }, ...sources.map((a) => ({ id: a.id, name: a.name, sub: a.type === 'savings' ? L('Poupança') : L('Gastos'), right: money(balOf(a)) }))]} onChange={setSFrom} />
              <TextRow icon={FI.money} money label={L('Valor a transferir')} value={sAmt} onChange={setSAmt} placeholder="0" />
              <DateRow label={sRep ? L('A primeira em') : L('Data')} value={sDate} onChange={setSDate} />
              <SwitchRow icon={FI.month} label={L('Repetir todos os meses')} on={sRep} onChange={setSRep} />
            </div>}
            <div className="nsv-acts"><button type="button" className="gl-act" disabled={busy} onClick={() => { setAskSave(false); setSkipSave(true); create(true, true); }}>{L('Só a conta de gastos')}</button><button type="button" className="gl-act ok" disabled={busy} onClick={() => create(false, true)}><Ic d="M20 6 9 17l-5-5" size={16} />{L('Criar as duas contas')}</button></div>
          </section></div>, document.body)}
        {edit?.onDelete && <button type="button" className="gx-rm lm-del" onClick={edit.onDelete}>{L('Apagar conta')}</button>}
      </div>
    </BottomSheet>
  );
}
