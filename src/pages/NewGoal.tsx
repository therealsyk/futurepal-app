import { Ic } from '../ui/fx';
import { useNavigate } from 'react-router-dom';
// Nova meta: os mesmos campos da conta de poupança (valor por mês, data limite) e, usando contas, uma transferência que se repete.
import { useState } from 'react';
import { db } from '../db/app-db';
import type { Account, Goal } from '../db/database';
import { activeCategories, addGoal, addRecurring, materializeDueRecurrings } from '../core/finance';
import { joinDesc, splitDesc } from '../core/debtPlan';
import { parseMoneyToCents } from '../core/money';
import { todayISO } from '../core/dates';
import { milestone } from '../core/onboarding';
import { loadSettings } from '../core/settings';
import { DatePicker } from '../ui/DatePicker';
import { Seg } from '../ui/fx';
import { AccountRow, AmountField, DateRow, FI, SwitchRow, TextRow, onlyDigits } from '../ui/formFields';
import { useMissing } from '../ui/missing';
import { PC_MOBILE } from '../core/uiMode';
import { L } from '../i18n/phrases';
import { BottomSheet } from './SimplePages';

const show = (c: number) => (c > 0 ? String(c / 100).replace('.', ',') : '');
const cents = (v: string) => Math.abs(parseMoneyToCents(v || '0') ?? 0);

export function NewGoal({ edit, presetEnd, current = 0, accounts, balOf, money, onClose, onDone }: { edit?: Goal; presetEnd?: string; current?: number; accounts: Account[]; balOf: (a: Account) => number; money: (c: number) => string; onClose: () => void; onDone: () => void }) {
  const s = loadSettings();
  const was = splitDesc(edit?.notes), wasM = was.plan?.monthlyCents ?? 0;
  const [target, setTarget] = useState(show(edit?.targetCents ?? 0)), [name, setName] = useState(edit?.name ?? ''), [notes, setNotes] = useState(was.text);
  const [hasMonthly, setHasMonthly] = useState(wasM > 0), [monthly, setMonthly] = useState(show(wasM));
  const [hasEnd, setHasEnd] = useState(!!presetEnd || !!edit?.targetDate), [end, setEnd] = useState(presetEnd ?? edit?.targetDate?.slice(0, 10) ?? '');
  const [how, setHow] = useState<'hand' | 'accounts'>(edit?.accountIds?.length ? 'accounts' : 'hand'), [accs, setAccs] = useState<string[]>(edit?.accountIds ?? []);
  const [repeat, setRepeat] = useState(false), [from, setFrom] = useState(''), [amount, setAmount] = useState<string | null>(null), [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [skipSugg, setSkipSugg] = useState(false);
  // pelo nome ou pela descrição: parece uma poupança ou o abate de uma dívida?
  const txt = (name + ' ' + notes).toLowerCase();
  const sugg: 'debt' | 'save' | null = /d[ií]vida|empr[ée]stimo|cr[ée]dito|abater|presta[cç]|hipoteca|cart[aã]o de cr|\bdebt\b|\bloan\b|mortgage|deuda|pr[eé]stamo|dette|cr[eé]dit/.test(txt) ? 'debt'
    : /poupan[cç]|poupar|fundo de emerg|emerg[eê]ncia|reserva|p[eé]-de-meia|aforro|\bsavings?\b|emergency fund|ahorro|[eé]pargne/.test(txt) ? 'save' : null;
  const pool = accounts.filter((a) => a.type !== 'debt'), byAcc = how === 'accounts';
  const sources = pool.filter((a) => !accs.includes(a.id)), src = sources.some((a) => a.id === from) ? from : sources.find((a) => a.isDefault)?.id ?? sources[0]?.id ?? '';
  const rep = byAcc && repeat, amt = amount ?? monthly, srcAcc = accounts.find((a) => a.id === src);
  const missing = useMissing();
  const miss = missing([['amount', L('o valor'), cents(target) > 0], ['name', L('o nome'), !!name.trim()], ['monthly', L('quanto juntar por mês'), !hasMonthly || cents(monthly) > 0], ['end', L('a data limite'), !hasEnd || !!end],
    ['accs', L('as contas'), !byAcc || accs.length > 0], ['from', L('a conta de onde sai o dinheiro'), !rep || !!src], ['rep', L('quanto transferir'), !rep || cents(amt) > 0]]);
  const create = async () => {
    if (!miss.check() || busy) return;
    setBusy(true);
    try {
      const m = hasMonthly ? cents(monthly) : 0;
      if (edit) {
        const toHand = !byAcc && !!edit.accountIds?.length; // deixou de usar contas: o que já tinha fica na meta
        await db.goals.update(edit.id, { name: name.trim(), targetCents: cents(target), targetDate: hasEnd && end ? end : null, notes: joinDesc(notes, m ? { monthlyCents: m, startCents: 0 } : null), accountIds: byAcc ? accs : [], ...(toHand ? { currentCents: Math.max(0, current) } : {}), updatedAt: new Date().toISOString() });
        onDone();
        return;
      }
      milestone('goal');
      const g = await addGoal(db, name.trim(), cents(target), todayISO(), hasEnd && end ? end : null);
      await db.goals.update(g.id, { notes: joinDesc(notes, m ? { monthlyCents: m, startCents: 0 } : null) || undefined, accountIds: byAcc ? accs : undefined });
      if (rep) {
        await addRecurring(db, { type: 'expense', categoryId: (await activeCategories(db))[0]?.id ?? '', description: name.trim(), amountCents: cents(amt), currency: s.currency, frequency: 'monthly', nextDate: date, endDate: hasEnd && end >= date ? end : null, accountId: src, toAccountId: accs[0] });
        await materializeDueRecurrings(db, todayISO());
      }
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <BottomSheet title={edit ? L('Alterar meta') : L('Nova meta')} onClose={onClose}>
      <div className="acc-form">
        {miss.note}
        <AmountField value={target} onChange={setTarget} currency={s.currency} label={L('Quanto queres juntar')} cls={miss.cls('amount')} autoFocus={PC_MOBILE} />
        <div className="tx-rows">
          <TextRow icon={FI.target} label={L('O que queres juntar?')} value={name} onChange={setName} placeholder={L('Ex.: Férias, carro')} cls={miss.cls('name')} />
          <TextRow label={L('Descrição')} value={notes} onChange={setNotes} />
        </div>
        {!edit && sugg && !skipSugg && <div className={'gsug ' + sugg}>
          <div className="gsug-head"><span className="gsug-ic"><Ic d={sugg === 'debt' ? 'M3 10l9-6 9 6M5 10v9h14v-9' : 'M19 7h-1V5a3 3 0 0 0-6 0v2H5v13h14zM14 5a1 1 0 0 1 2 0v2h-2z'} size={20} /></span>
            <div><b>{sugg === 'debt' ? L('Parece que queres abater uma dívida') : L('Parece que queres juntar uma poupança')}</b><small>{sugg === 'debt' ? L('Uma conta de dívida faz o mesmo acompanhamento, e mais:') : L('Uma conta de poupança faz o mesmo acompanhamento, e mais:')}</small></div></div>
          <ul>{(sugg === 'debt' ? [L('Mostra quanto deves e quando acabas, com juros'), L('Sugere como acabar mais depressa'), L('As prestações saem sozinhas da tua conta')] : [L('O saldo da conta é o teu progresso, sem registos à mão'), L('Pode receber uma transferência automática todos os meses'), L('Conta para o teu património')]).map((x) => <li key={x}><Ic d="M20 6 9 17l-5-5" size={14} />{x}</li>)}</ul>
          <div className="gsug-acts"><button type="button" className="gsug-go" onClick={() => { onClose(); navigate(`/contas?tab=${sugg === 'debt' ? 'debt' : 'savings'}&nova=1&nome=${encodeURIComponent(name.trim())}${cents(target) > 0 ? '&valor=' + cents(target) : ''}`); }}>{sugg === 'debt' ? L('Criar conta de dívida') : L('Criar conta de poupança')}<Ic d="M5 12h14M13 6l6 6-6 6" size={15} /></button>
            <button type="button" className="gsug-no" onClick={() => setSkipSugg(true)}>{L('Continuar como meta')}</button></div>
        </div>}
        <div className="tx-rows">
          <SwitchRow icon={FI.month} cls={miss.cls('monthly')} label={hasMonthly ? L('Juntar por mês') : L('Juntar um valor certo por mês?')} sub={hasMonthly ? undefined : L('Se não, vais juntando quando puderes')} on={hasMonthly} onChange={setHasMonthly}>
            <input className="tx-val" inputMode="decimal" value={monthly} placeholder={L('Ex.: 500')} onChange={(e) => setMonthly(onlyDigits(e.target.value))} /></SwitchRow>
          <SwitchRow icon={FI.date} cls={miss.cls('end')} label={hasEnd ? L('Data limite') : L('Tem data limite?')} sub={hasEnd ? undefined : L('Ex.: quero ter o dinheiro até ao verão')} on={hasEnd} onChange={setHasEnd}><DatePicker value={end} onChange={setEnd} className="fx-input tx-val" /></SwitchRow>
        </div>
        <h3 className="acc-how">{L('Como queres juntar?')}</h3>
        <div className="tx-seg"><Seg value={how} onChange={setHow} label={L('Como queres juntar?')} options={[{ id: 'hand', label: L('Registar à mão') }, { id: 'accounts', label: L('Transferir de outra conta') }]} /></div>
        {<p className="gl-hint gl-hint2"><Ic d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 16v-4M12 8h.01" size={14} />{how === 'hand' ? L('Vais dizendo à app quanto juntaste. Não mexe em nenhuma conta.') : L('O dinheiro da meta fica guardado numa conta tua. Só conta o que juntares a partir de agora.')}</p>}
        {byAcc && <h3 className="acc-how ng-sub">{L('Em que conta fica o dinheiro?')}</h3>}
        {byAcc && <div className={'tx-rows' + miss.cls('accs')}>
          {pool.map((a) => <SwitchRow key={a.id} icon="M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2" label={a.name} sub={<b className={balOf(a) < 0 ? 'fx-neg' : 'fx-pos'}>{money(balOf(a))}</b>} on={accs.includes(a.id)} onChange={(v) => setAccs(v ? [...accs, a.id] : accs.filter((x) => x !== a.id))} />)}
        </div>}
        {byAcc && !edit && accs.length > 0 && sources.length > 0 && <>
          <h3 className="acc-how ng-sub">{L('Pôr dinheiro sozinho todos os meses?')}</h3>
          <div className="tx-rows ng-auto">
          <SwitchRow icon={FI.month} label={L('Transferir todos os meses?')} sub={repeat ? undefined : L('Passa sozinho de outra conta para esta')} on={repeat} onChange={setRepeat} />
          {rep && sources.length > 0 && <>
            <AccountRow label={L('Da conta')} cls={miss.cls('from')} value={src} options={sources.map((a) => ({ id: a.id, name: a.name, sub: a.type === 'savings' ? L('Poupança') : L('Gastos'), right: money(balOf(a)) }))} balance={srcAcc && money(balOf(srcAcc))} onChange={setFrom} />
            <TextRow icon={FI.money} money label={L('Valor a transferir')} value={amt} onChange={setAmount} placeholder="0" cls={miss.cls('rep')} />
            <DateRow label={L('A primeira em')} value={date} onChange={setDate} />
          </>}
        </div></>}
        <button type="button" className="tx-addbtn" disabled={busy} onClick={create}>{edit ? L('Guardar') : L('Criar meta')}</button>
      </div>
    </BottomSheet>
  );
}
