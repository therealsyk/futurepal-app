// Janela "Nova transação": uma só para toda a app. Fica por cima das páginas e continua aberta quando a página de fundo muda
// (Despesa mostra as Transações; Rendimento mostra Salários e extras).
import { startTransition, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { db } from '../db/app-db';
import { stampNew } from '../db/database';
import type { Account, Category, Group, RecurringFrequency } from '../db/database';
import { accountBalanceCents as balOfAcc, addTransfer, defaultAccountId, listAccounts, salariesUntil } from '../core/accounts';
import { activeCategories, addRecurring, addTransaction, listGroups, materializeDueRecurrings, RECURRING_FREQUENCIES } from '../core/finance';
import { todayISO } from '../core/dates';
import { splitIdOf } from '../core/groupLink';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { syncSalaryTransactions } from '../core/salaryTx';
import { loadSettings } from '../core/settings';
import { addSplitTransaction, putMyShare, splitPeople } from '../core/splitInvite';
import { SIMPLE_UI } from '../core/uiMode';
import { L } from '../i18n/phrases';
import { CalculatorButton } from './Calculator';
import { appConfirm } from './confirm';
import { DatePicker } from './DatePicker';
import { AccountRow, AmountField, CategoryRow, DateRow, FI, RepeatRows, Row, TextRow } from './formFields';
import { catLabel, CategorySelect, Field, Ic, ICON, PickMenu, Seg, Sheet, Toggle } from './fx';
import { FormError, useMissing } from './missing';
import { useIsMobile } from './useIsMobile';

export interface TxFormOptions { type: 'expense' | 'income'; accountId?: string; groupId?: string; toAccount?: string }
interface FormData { accounts: Account[]; cats: Category[]; groups: Group[]; bals: Record<string, number> }

const OPEN = 'wallet:tx-open', SAVED = 'wallet:tx-saved';
/** Abre a janela, em qualquer página. */
export const openTxForm = (o: TxFormOptions) => { window.dispatchEvent(new CustomEvent(OPEN, { detail: o })); };
/** Para as páginas se atualizarem depois de guardar. */
export function useTxSaved(fn: () => void) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { const h = () => ref.current(); window.addEventListener(SAVED, h); return () => window.removeEventListener(SAVED, h); }, []);
}

/** Categoria "Rendimentos extras": criada na primeira vez que é precisa. */
async function ensureExtras() {
  if ((await db.categories.toArray()).some((c) => c.deletedAt === null && c.name === 'extras')) return;
  await db.categories.add(stampNew<Category>({ name: 'extras', color: '#34D399', icon: '', order: 99, nameKey: 'salaries.extras' }));
}

/** Já existe um rendimento com o mesmo valor a 3 dias ou menos? */
async function sameIncome(cents: number, date: string) {
  const day = (d: string) => new Date(d + 'T00:00:00').getTime() / 864e5;
  return (await db.transactions.toArray()).some((x) => x.deletedAt === null && x.type === 'income' && x.amountCents === cents && Math.abs(day(x.date) - day(date)) <= 3);
}

async function loadData(type: 'expense' | 'income'): Promise<FormData> {
  if (type === 'income') await ensureExtras();
  const [accounts, cats, groups, all, trs, sals] = await Promise.all([listAccounts(db), activeCategories(db), listGroups(db), db.transactions.toArray(), db.transfers.toArray(), db.salaries.toArray()]);
  const n = new Date(), sal = salariesUntil(sals, n.getFullYear(), n.getMonth() + 1);
  const live = all.filter((x) => x.deletedAt === null), lt = trs.filter((x) => x.deletedAt === null);
  return { accounts, cats, groups, bals: Object.fromEntries(accounts.map((a) => [a.id, balOfAcc(a, live, accounts, sal, lt)])) };
}

/** Fica sempre montado (App): é por isso que a janela não fecha quando a página muda. */
export function TxFormHost() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState<{ n: number; o: TxFormOptions; d: FormData } | null>(null);
  const at = useRef(pathname); // página onde a janela deve estar
  useEffect(() => {
    const h = (e: Event) => { const o = (e as CustomEvent<TxFormOptions>).detail; loadData(o.type).then((d) => { at.current = window.location.hash.replace(/^#/, '').split('?')[0] || '/'; setForm({ n: Date.now(), o, d }); }).catch(() => {}); };
    window.addEventListener(OPEN, h);
    return () => window.removeEventListener(OPEN, h);
  }, []);
  useEffect(() => { if (pathname !== at.current) { at.current = pathname; setForm(null); } }, [pathname]); // saiu da página (ex.: botão Voltar do telemóvel)
  if (!form) return null;
  const goto = (to: string) => { if (at.current === to) return; at.current = to; startTransition(() => navigate(to, { replace: true })); };
  return <TxForm key={form.n} o={form.o} d={form.d} onClose={() => setForm(null)} onKind={(k) => { if (['/transacoes', '/salarios'].includes(at.current)) goto(k === 'income' ? '/salarios' : '/transacoes'); }} />;
}

function TxForm({ o, d, onClose, onKind }: { o: TxFormOptions; d: FormData; onClose: () => void; onKind: (k: 'expense' | 'income') => void }) {
  const { t } = useTranslation();
  const settings = loadSettings();
  const auth = useAuth();
  const isMobile = useIsMobile();
  const missing = useMissing();
  const { accounts, groups, bals } = d;
  const money = (c: number) => formatMoney(c, settings.currency, settings.language);
  const [cats, setCats] = useState(d.cats);
  const [type, setType] = useState(o.type);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState(o.type === 'income' ? '' : d.cats[0]?.id ?? '');
  const [groupId, setGroupId] = useState(o.groupId ?? '');
  const [toAccount, setToAccount] = useState(accounts.some((a) => a.id === o.toAccount) ? o.toAccount! : ''); // '' = transação normal; id = transferência para essa conta
  const [accountId, setAccountId] = useState(() => {
    if (toAccount) return (accounts.find((a) => a.isDefault && a.id !== toAccount) ?? accounts.find((a) => a.type !== 'debt' && a.id !== toAccount))?.id ?? '';
    return o.accountId ?? defaultAccountId(accounts) ?? '';
  });
  const [recurring, setRecurring] = useState(false);
  const [freq, setFreq] = useState<RecurringFrequency>('monthly');
  const [endDate, setEndDate] = useState('');
  const [moreOpts, setMoreOpts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitInfo, setSplitInfo] = useState(0); // por quantas pessoas se divide o grupo escolhido
  useEffect(() => {
    const id = splitIdOf(groupId);
    let on = true;
    if (!id) { setSplitInfo(0); return; }
    splitPeople(id).then((p) => { if (on) setSplitInfo(p ? p.members.length + p.pending : 0); }, () => {});
    return () => { on = false; };
  }, [groupId]);

  const done = () => { window.dispatchEvent(new Event(SAVED)); onClose(); };
  // Rendimento: a categoria escolhe-se sempre (não fica uma por acaso)
  const pickType = (v: 'expense' | 'income') => {
    if (v === type) return;
    setType(v); setError(null);
    setCategoryId(v === 'income' ? '' : cats[0]?.id ?? '');
    if (v === 'income') ensureExtras().then(() => activeCategories(db)).then(setCats).catch(() => {});
    onKind(v);
  };
  const miss = missing([['amount', L('o valor'), (parseMoneyToCents(amount) ?? 0) > 0], ['cat', L('a categoria'), (SIMPLE_UI && !!toAccount) || !!categoryId], ['date', L('a data'), !!date]]);
  const submit = async () => {
    const cents = parseMoneyToCents(amount);
    setError(null);
    if (!miss.check() || cents === null) return;
    if (type === 'income' && !toAccount && await sameIncome(cents, date) && !(await appConfirm(L('Já existe um rendimento com este valor nesta data. Adicionar na mesma?'), { ok: L('Sim') }))) return;
    // grupo dividido: a transação é dividida por todos e nas minhas fica só a minha parte
    const splitId = !toAccount ? splitIdOf(groupId) : null;
    let mine = cents, billId = '';
    if (splitId && type === 'income') { setError(L('Num grupo dividido só se adicionam despesas.')); return; }
    const splitCat = cats.find((x) => x.id === categoryId), splitDesc = description.trim() || (splitCat ? catLabel(t, splitCat) : L('Despesa'));
    if (splitId) {
      if (recurring) { setError(L('Uma transação dividida não pode ser recorrente.')); return; }
      const r = await addSplitTransaction(splitId, splitDesc, cents, date);
      if ('error' in r) { setError(r.error === 'offline' ? L('Para dividir precisas de internet e de sessão iniciada.') : r.error); return; }
      mine = r.share; billId = r.billId;
    }
    if (SIMPLE_UI && toAccount) { // transferência entre contas (pode repetir-se)
      try {
        if (recurring) {
          if (endDate && endDate < date) { setError(t('transactions.endBeforeStart')); return; }
          await addRecurring(db, { type: 'expense', categoryId: categoryId || (cats[0]?.id ?? ''), description: description.trim() || L('Transferência'), amountCents: cents, currency: settings.currency, frequency: freq, nextDate: date, endDate: endDate || null, accountId, toAccountId: toAccount });
          await materializeDueRecurrings(db, todayISO());
        } else {
          await addTransfer(db, { fromAccountId: accountId, toAccountId: toAccount, amountCents: cents, date, note: description.trim(), categoryId: null });
        }
        done();
      } catch (e) { setError(String(e)); }
      return;
    }
    try {
      if (recurring) {
        if (endDate && endDate < date) { setError(t('transactions.endBeforeStart')); return; }
        // A recorrente gera a 1.ª ocorrência (se a data já chegou) e as seguintes quando vencerem.
        await addRecurring(db, { type, categoryId, description: description.trim(), amountCents: cents, currency: settings.currency, frequency: freq, nextDate: date, endDate: endDate || null, accountId: accountId || undefined });
        await materializeDueRecurrings(db, todayISO());
      } else {
        if (billId) await putMyShare(db, billId, auth.user?.id ?? '', { date, type, categoryId, description: splitDesc, amountCents: mine, currency: settings.currency, groupId, accountId: accountId || undefined });
        else await addTransaction(db, { date, type, categoryId, description: description.trim(), amountCents: cents, currency: settings.currency, groupId: groupId || undefined, accountId: accountId || undefined });
        if (type === 'income') await syncSalaryTransactions(db).catch(() => {}); // categoria Salário -> aba Salários
      }
      done();
    } catch (e) { setError(String(e)); }
  };


  return (
      <Sheet open onClose={onClose} title={toAccount ? L('Transferência') : t('transactions.addTransaction')}
        footer={SIMPLE_UI && isMobile
          ? <><button type="button" className="tx-addbtn" onClick={submit}>{toAccount ? L('Transferir') : type === 'expense' ? L('Adicionar despesa') : L('Adicionar rendimento')}</button><CalculatorButton value={amount} lang={settings.language} onUse={setAmount} /></>
          : <><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={onClose}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={submit}>{t('common.add')}</button><CalculatorButton value={amount} lang={settings.language} onUse={setAmount} /></>}>
        {miss.note ?? (error && <FormError text={error} />)}
        {SIMPLE_UI && isMobile ? (<>
          {/* Formulário (telemóvel): valor grande e linhas com ícone */}
          <div className="tx-seg"><Seg value={type} onChange={pickType} label={t('transactions.type')} options={[{ id: 'expense', label: t('transactions.typeExpense') }, { id: 'income', label: t('transactions.typeIncome') }]} /></div>
          <AmountField value={amount} onChange={setAmount} currency={settings.currency} cls={miss.cls('amount')} autoFocus kind={toAccount ? undefined : type} />
          <div className="tx-rows">
            <TextRow label={t('transactions.description')} value={description} onChange={setDescription} />
            {toAccount ? <Row div icon={FI.cat} label={t('transactions.category')}><span className="tx-muted">{L('Transferência')}</span></Row> : <CategoryRow cats={cats} kind={type} value={categoryId} onChange={setCategoryId} cls={miss.cls('cat')} required={type === 'income'} />}
            <AccountRow label={toAccount ? L('Da conta') : t('accounts.account')} value={accountId} options={accounts.map((a) => ({ id: a.id, name: a.name, right: bals[a.id] !== undefined ? money(bals[a.id]) : undefined }))} balance={bals[accountId] !== undefined ? money(bals[accountId]) : undefined} onChange={(v) => { setAccountId(v); if (v === toAccount) setToAccount(''); }} />
            {!toAccount && <button type="button" className="tx-row tx-swaprow" onClick={() => (accounts.length > 1 ? setToAccount(accounts.find((a) => a.id !== accountId)?.id ?? '') : setError(L('Para transferir, cria primeiro outra conta (ex.: Poupanças) em Contas.')))}><span><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={18} />{L('Transferir para outra conta')}</span><Ic d={ICON.right} size={16} /></button>}
            {toAccount && <AccountRow icon={FI.swap} label={L('Para a conta')} value={toAccount} options={accounts.filter((a) => a.id !== accountId).map((a) => ({ id: a.id, name: a.name }))} owed={accounts.find((a) => a.id === toAccount)?.type === 'debt'} balance={bals[toAccount] !== undefined ? money(bals[toAccount]) : undefined} onChange={setToAccount}>
              <button type="button" className="tx-swap off" onClick={() => setToAccount('')} aria-label={L('Cancelar transferência')}><Ic d={ICON.close} size={16} /></button></AccountRow>}
            <DateRow label={t('transactions.date')} value={date} onChange={setDate} testId="tx-date" />
            {!toAccount && groups.length > 0 && <label className="tx-row"><span><Ic d="M4 6h16M4 12h16M4 18h10" size={18} />{L('Grupo')}</span>
              <PickMenu compact label={L('Grupo')} value={groupId} options={[{ value: '', label: L('Nenhum') }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} onChange={(v) => setGroupId(String(v))} /></label>}
            {splitInfo > 0 && type === 'expense' && !toAccount && <p className="gx-hint"><Ic d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6" size={16} />{L('Dividida por')} {splitInfo} {splitInfo === 1 ? L('pessoa') : L('pessoas')}{(parseMoneyToCents(amount) ?? 0) > 0 ? `: ${L('a tua parte é')} ${money(Math.ceil(parseMoneyToCents(amount)! / splitInfo))}` : ''}</p>}
            <RepeatRows label={toAccount ? L('Repetir todos os meses') : undefined} on={recurring} setOn={setRecurring} freq={freq} setFreq={setFreq} end={endDate} setEnd={setEndDate} />
          </div>
        </>) : (<>
        <Seg value={type} onChange={pickType} label={t('transactions.type')} options={[{ id: 'expense', label: t('transactions.typeExpense') }, { id: 'income', label: t('transactions.typeIncome') }]} />
        <Field label={t('transactions.amount')} miss={miss.cls('amount')}><input className="fx-input big" autoFocus inputMode="decimal" value={amount} placeholder="0,00" onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('transactions.description')}><input className="fx-input" value={description} placeholder={t('transactions.descriptionPlaceholder')} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="fx-two">
          <Field label={t('transactions.category')}>
            <CategorySelect cats={cats} kind={type} value={categoryId} onChange={setCategoryId} ariaLabel={t('transactions.category')} emptyLabel={type === 'income' ? L('Escolher…') : undefined} />
          </Field>
          <Field label={t('transactions.date')}><DatePicker value={date} onChange={setDate} ariaLabel={t('transactions.date')} testId="tx-date" /></Field>
        </div>
        {isMobile && !moreOpts ? (
          <button type="button" className="tx-moreopts" onClick={() => setMoreOpts(true)}>+ {t('mobile.moreOptions')}</button>
        ) : (<>
          <div className="fx-two">
            <Field label={t('accounts.account')}>
              <select className="fx-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </Field>
            <Field label={t('goals.groupName')}>
              <select className="fx-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">—</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            </Field>
          </div>
          <Toggle on={recurring} onChange={setRecurring} label={t('transactions.recurring')} hint={t('transactions.recurringHint')} />
          {recurring && (
            <div className="fx-two">
              <Field label={t('goals.frequency')}>
                <select className="fx-input" value={freq} onChange={(e) => setFreq(e.target.value as RecurringFrequency)}>
                  {RECURRING_FREQUENCIES.map((f) => <option key={f} value={f}>{t('goals.' + f)}</option>)}
                </select>
              </Field>
              <Field label={t('transactions.recurringEnd')}>
                <DatePicker value={endDate} onChange={setEndDate} allowEmpty ariaLabel={t('transactions.recurringEnd')} />
              </Field>
            </div>
          )}
        </>)}
        </>)}
      </Sheet>
  );
}
