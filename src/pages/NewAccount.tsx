// Nova conta: o tipo em cima (Gastos | Poupança | Dívidas) e, conforme o tipo, o plano por mês, juros, data limite (cria a meta) e transferência.
import { useState } from 'react';
import { db } from '../db/app-db';
import type { Account } from '../db/database';
import { addAccount, addTransfer, updateAccount } from '../core/accounts';
import { activeCategories, addGoal, addRecurring, materializeDueRecurrings } from '../core/finance';
import { joinDesc, payoff, type DebtPlan } from '../core/debtPlan';
import { parseMoneyToCents } from '../core/money';
import { todayISO } from '../core/dates';
import { loadSettings } from '../core/settings';
import { DatePicker } from '../ui/DatePicker';
import { Seg } from '../ui/fx';
import { AccountRow, AmountField, DateRow, FI, SwitchRow, TextRow, onlyDigits as digits } from '../ui/formFields';
import { PC_MOBILE } from '../core/uiMode';
import { useMissing, type MissRule } from '../ui/missing';
import { L } from '../i18n/phrases';
import { fill } from '../ui/AccountPlan';
import { BottomSheet } from './SimplePages';

const cents = (v: string) => Math.abs(parseMoneyToCents(v || '0') ?? 0);

export function NewAccount({ initial, accounts, balOf, money, endText, onClose, onDone }: {
  initial: Account['type']; accounts: Account[]; balOf: (a: Account) => number; money: (c: number) => string; endText: (months: number) => string;
  onClose: () => void; onDone: (kind: Account['type']) => void;
}) {
  const s = loadSettings();
  const [kind, setKind] = useState<Account['type']>(initial);
  const [bal, setBal] = useState(''), [name, setName] = useState(''), [desc, setDesc] = useState('');
  const [hasMonthly, setHasMonthly] = useState(false), [monthly, setMonthly] = useState('');
  const [hasRate, setHasRate] = useState(false), [rate, setRate] = useState('');
  const [hasEnd, setHasEnd] = useState(false), [end, setEnd] = useState('');
  const [wantGoal, setWantGoal] = useState(false), [target, setTarget] = useState('');
  const [how, setHow] = useState<'hand' | 'transfer'>('hand');
  const [from, setFrom] = useState(''), [amount, setAmount] = useState<string | null>(null), [date, setDate] = useState(todayISO()), [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);

  const debt = kind === 'debt', plan = kind !== 'spending', start = cents(bal);
  const m = plan && hasMonthly ? cents(monthly) : 0, r = debt && hasRate ? Number(rate.replace(',', '.')) || 0 : 0;
  const goal = plan && wantGoal, transfer = plan && how === 'transfer';
  const now = new Date(), e = hasEnd && end ? new Date(end + 'T00:00:00') : null;
  const monthsLeft = e ? Math.max(1, (e.getFullYear() - now.getFullYear()) * 12 + e.getMonth() - now.getMonth()) : 0;
  const auto = m && monthsLeft ? start + m * monthsLeft : 0; // objetivo, se disser quanto por mês e até quando
  const goalCents = debt ? start : cents(target) || auto;
  const sources = accounts.filter((a) => a.type !== 'debt' && a.currency === s.currency);
  const src = from || sources.find((a) => a.isDefault)?.id || sources[0]?.id || '';
  const amt = amount ?? monthly, po = debt ? payoff(start, m, r) : null;

  const missing = useMissing();
  const first: MissRule[] = [
    ['bal', debt ? L('quanto deves') : '', !debt || start > 0], ['name', L('o nome'), !!name.trim()],
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

  const create = async () => {
    if (!miss.check() || busy) return;
    setBusy(true);
    try {
      const p: DebtPlan | null = plan ? { monthlyCents: m, startCents: start, rate: r || undefined } : null;
      const acc = await addAccount(db, { name: name.trim(), description: joinDesc(desc, p), type: kind, currency: s.currency, initialBalanceCents: start, includeInNetWorth: true, isDefault: false, showOnHome: true });
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
      onDone(kind);
    } finally { setBusy(false); }
  };

  const numIn = (v: string, set: (v: string) => void, hint: string) => <input className="tx-val" inputMode="decimal" value={v} placeholder={hint} onChange={(x) => set(digits(x.target.value))} />;
  const src2 = accounts.find((a) => a.id === src);
  const need = !hasMonthly && e && goalCents > 0 ? Math.ceil(Math.max(0, goalCents - (debt ? 0 : start)) / monthsLeft) : 0;

  const partA = <>
    <AmountField value={bal} onChange={setBal} currency={s.currency} label={debt ? L('Quanto deves') : L('Saldo inicial')} cls={miss.cls('bal')} autoFocus={PC_MOBILE} />
    <div className="tx-rows">
      <TextRow icon={FI.name} label={L('Nome da conta')} value={name} onChange={setName} cls={miss.cls('name')} placeholder={debt ? L('Ex.: Empréstimo da casa') : kind === 'savings' ? L('Ex.: Poupanças') : L('Ex.: Conta do banco')} />
      <TextRow label={L('Descrição')} value={desc} onChange={setDesc} />
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
      {<SwitchRow icon={FI.track} label={debt ? L('Acompanhar esta dívida?') : L('Acompanhar esta poupança?')} sub={L('Mostra quanto falta, dentro da própria conta')} on={wantGoal} onChange={(v) => { setWantGoal(v); if (!v) setHasEnd(false); }} />}
      {goal && !debt && <TextRow icon={FI.target} money label={L('Quanto queres juntar no total')} value={target} onChange={setTarget} placeholder={auto ? money(auto) : L('Ex.: 5000')} cls={miss.cls('target')} />}
    </div>
    <h3 className="acc-how">{debt ? L('Como queres pagar?') : L('Como queres juntar?')}</h3>
    <div className="tx-seg"><Seg value={how} onChange={setHow} label={debt ? L('Como queres pagar?') : L('Como queres juntar?')} options={[{ id: 'hand', label: L('À mão') }, { id: 'transfer', label: L('Transferir de outra conta') }]} /></div>
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
    {need > 0 && <p className="debt-prev">{fill(debt ? L('Para acabar a tempo precisas de abater cerca de {m} por mês') : L('Para lá chegares a tempo precisas de juntar cerca de {m} por mês'), { m: money(need) })}</p>}
  </>;
  return (
    <BottomSheet title={L('Nova conta')} onClose={onClose}>
      <div className="acc-form">
        {miss.note}
        <div className="tx-seg acc-kind"><Seg value={kind} onChange={pickKind} label={L('Tipo de conta')} options={[{ id: 'spending', label: L('Gastos') }, { id: 'savings', label: L('Poupança') }, { id: 'debt', label: L('Dívidas') }]} /></div>
        {partA}
        {partB}
        <button type="button" className="tx-addbtn" disabled={busy} onClick={create}>{L('Criar conta')}</button>
      </div>
    </BottomSheet>
  );
}
