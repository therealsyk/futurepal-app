// Nova conta: o tipo em cima (Gastos | Poupança | Dívidas) e, conforme o tipo, o plano por mês, juros, data limite (cria a meta) e transferência.
import { useState, type ReactNode } from 'react';
import { db } from '../db/app-db';
import type { Account } from '../db/database';
import { addAccount, addTransfer, updateAccount } from '../core/accounts';
import { activeCategories, addGoal, addRecurring, materializeDueRecurrings } from '../core/finance';
import { joinDesc, payoff, type DebtPlan } from '../core/debtPlan';
import { parseMoneyToCents } from '../core/money';
import { todayISO } from '../core/dates';
import { loadSettings } from '../core/settings';
import { DatePicker } from '../ui/DatePicker';
import { PickMenu, Seg } from '../ui/fx';
import { useMissing } from '../ui/missing';
import { L } from '../i18n/phrases';
import { BottomSheet, fill } from './SimplePages';

const digits = (v: string) => v.replace(/[^\d.,]/g, '');
const cents = (v: string) => Math.abs(parseMoneyToCents(v || '0') ?? 0);

function Tog({ label, sub, on, set }: { label: string; sub?: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="tx-row acc-tog"><span>{label}{sub && <small>{sub}</small>}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={'ob-toggle' + (on ? ' on' : '')} onClick={() => set(!on)}><i /></button></div>
  );
}

export function NewAccount({ initial, accounts, money, endText, onClose, onDone }: {
  initial: Account['type']; accounts: Account[]; money: (c: number) => string; endText: (months: number) => string;
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
  const goal = plan && (hasEnd || wantGoal), transfer = plan && how === 'transfer';
  const now = new Date(), e = hasEnd && end ? new Date(end + 'T00:00:00') : null;
  const monthsLeft = e ? Math.max(1, (e.getFullYear() - now.getFullYear()) * 12 + e.getMonth() - now.getMonth()) : 0;
  const auto = m && monthsLeft ? start + m * monthsLeft : 0; // objetivo, se disser quanto por mês e até quando
  const goalCents = debt ? start : cents(target) || auto;
  const sources = accounts.filter((a) => a.type !== 'debt' && a.currency === s.currency);
  const src = from || sources.find((a) => a.isDefault)?.id || sources[0]?.id || '';
  const amt = amount ?? monthly, po = debt ? payoff(start, m, r) : null;

  const missing = useMissing();
  const miss = missing([
    ['bal', debt ? L('quanto deves') : '', !debt || start > 0], ['name', L('o nome'), !!name.trim()],
    ['monthly', debt ? L('quanto abater por mês') : L('quanto juntar por mês'), !plan || (!hasMonthly && !r) || m > 0],
    ['rate', L('os juros'), !debt || !hasRate || r > 0],
    ['low', L('um valor por mês maior do que os juros'), !debt || !r || !m || !!po],
    ['end', L('a data limite'), !plan || !hasEnd || !!end], ['target', L('quanto queres juntar no total'), !goal || goalCents > 0],
    ['from', L('a conta de onde sai o dinheiro'), !transfer || !!src], ['amount', L('quanto transferir'), !transfer || cents(amt) > 0],
  ]);

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

  const row = (key: string, label: string, input: ReactNode) => <label className={miss.cls(key)}>{label}{input}</label>;
  const numIn = (v: string, set: (v: string) => void, ph: string) => <input inputMode="decimal" value={v} placeholder={ph} onChange={(x) => set(digits(x.target.value))} />;
  return (
    <BottomSheet title={L('Nova conta')} onClose={onClose}>
      {miss.note}
      <section className="mv-card sh-form acc-form">
        <div className="tx-seg acc-kind"><Seg value={kind} onChange={setKind} label={L('Tipo de conta')} options={[{ id: 'spending', label: L('Gastos') }, { id: 'savings', label: L('Poupança') }, { id: 'debt', label: L('Dívidas') }]} /></div>
        <label className={'bs-amount' + miss.cls('bal')}><small>{debt ? L('Quanto deves') : L('Saldo inicial')}</small><input className="tx-amt" inputMode="decimal" value={bal} onChange={(x) => setBal(digits(x.target.value))} placeholder="0" /><span className="tx-cur">{s.currency}</span></label>
        {row('name', L('Nome da conta'), <input value={name} onChange={(x) => setName(x.target.value)} placeholder={debt ? L('Ex.: Empréstimo da casa') : kind === 'savings' ? L('Ex.: Poupanças') : L('Ex.: Conta do banco')} />)}
        {row('desc', L('Descrição'), <input value={desc} maxLength={120} onChange={(x) => setDesc(x.target.value)} placeholder={L('Opcional')} />)}
        {plan && <>
          <Tog label={debt ? L('Abater um valor certo por mês?') : L('Juntar um valor certo por mês?')} sub={hasMonthly ? undefined : debt ? L('Se não, vais abatendo quando puderes') : L('Se não, vais juntando quando puderes')} on={hasMonthly} set={setHasMonthly} />
          {(hasMonthly || (debt && hasRate)) && row(miss.cls('low') ? 'low' : 'monthly', debt ? L('Abater por mês') : L('Juntar por mês'), numIn(monthly, (v) => { setMonthly(v); setHasMonthly(true); }, L('Ex.: 500')))}
          {debt && <Tog label={L('Tem juros?')} on={hasRate} set={(v) => { setHasRate(v); if (v) setHasMonthly(true); }} />}
          {debt && hasRate && row('rate', L('Juros por ano (%)'), numIn(rate, setRate, L('Ex.: 3,5')))}
          <Tog label={L('Tem data limite?')} sub={L('Com data, é criada uma meta ligada a esta conta')} on={hasEnd} set={setHasEnd} />
          {hasEnd && row('end', L('Até quando'), <DatePicker value={end} onChange={setEnd} className="fx-input tx-val" />)}
          {!hasEnd && <Tog label={L('Criar uma meta?')} on={wantGoal} set={setWantGoal} />}
          {goal && !debt && row('target', L('Quanto queres juntar no total'), numIn(target, setTarget, auto ? money(auto) : L('Ex.: 5000')))}
          <div className="sh-accpick"><small>{debt ? L('Como queres pagar?') : L('Como queres juntar?')}</small>
            <div className="sh-seg small">
              <button type="button" className={how === 'hand' ? 'on' : ''} onClick={() => setHow('hand')}>{debt ? L('À mão') : L('Vou juntando à mão')}</button>
              <button type="button" className={how === 'transfer' ? 'on' : ''} onClick={() => setHow('transfer')}>{L('Transferir de outra conta')}</button>
            </div></div>
          {transfer && <>
            {row('from', L('Da conta'), <PickMenu compact label={L('Da conta')} value={src} options={sources.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => setFrom(String(v))} />)}
            {row('amount', L('Valor a transferir'), numIn(amt, setAmount, '0'))}
            {row('date', recurring ? L('A primeira em') : L('Data'), <DatePicker value={date} onChange={setDate} className="fx-input tx-val" />)}
            <Tog label={L('Recorrente')} sub={recurring ? L('Repete todos os meses') : undefined} on={recurring} set={setRecurring} />
          </>}
          {debt && po && m > 0 && start > 0 && <div className="debt-sum">
            <p><span>{L('Sem juros')}</span><b>{money(start)}</b></p>
            {r > 0 && <p><span>{L('Com juros')}</span><b>{money(po.totalCents)}</b></p>}
            {r > 0 && <p><span>{L('Só de juros')}</span><b className="fx-neg">{money(po.totalCents - start)}</b></p>}
            <p className="debt-prev">{endText(po.months)}</p>
          </div>}
          {!hasMonthly && e && goalCents > 0 && <p className="debt-prev">{fill(debt ? L('Para acabar a tempo precisas de abater cerca de {m} por mês') : L('Para lá chegares a tempo precisas de juntar cerca de {m} por mês'), { m: money(Math.ceil(Math.max(0, goalCents - (debt ? 0 : start)) / monthsLeft)) })}</p>}
        </>}
        <button type="button" className="sh-btn in sm" disabled={busy} onClick={create}>{L('Criar conta')}</button>
      </section>
    </BottomSheet>
  );
}
