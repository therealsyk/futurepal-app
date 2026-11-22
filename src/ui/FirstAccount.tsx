// Antes da primeira transação: a pessoa cria a conta de onde sai (ou onde entra) o dinheiro.
import { useState } from 'react';
import { createAccount, DEFAULT_ACCOUNT_ID, listAccounts, updateAccount, type NewAccount } from '../core/accounts';
import { parseMoneyToCents } from '../core/money';
import { milestone } from '../core/onboarding';
import { db } from '../db/app-db';
import { L } from '../i18n/phrases';
import { BottomSheet } from '../pages/SimplePages';
import { AmountField, FI, TextRow } from './formFields';
import { Ic, ICON } from './fx';
import { useMissing } from './missing';

export function FirstAccount({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const missing = useMissing(), miss = missing([['name', L('o nome'), !!name.trim()]]);
  const save = async () => {
    if (busy || !miss.check()) return;
    setBusy(true);
    const input: NewAccount = { name: name.trim(), description: '', type: 'spending', currency, initialBalanceCents: parseMoneyToCents(v) ?? 0, includeInNetWorth: true, isDefault: true, showOnHome: true };
    // com movimentos já na conta automática, é essa que passa a ser a conta da pessoa
    const only = await listAccounts(db);
    if (only.length === 1 && only[0].id === DEFAULT_ACCOUNT_ID) await updateAccount(db, DEFAULT_ACCOUNT_ID, input); else await createAccount(db, input);
    milestone('account');
    onDone();
  };
  return (
    <BottomSheet title={L('Primeiro, cria a tua conta')} onClose={onClose}>
      <div className="acc-form fa-form">
        <div className="fa-top"><span className="on-logo sm"><Ic d={ICON.wallet} size={30} /></span><p>{L('É de onde sai o dinheiro: o teu banco, um cartão ou a carteira. A seguir adicionas a transação.')}</p></div>
        {miss.note}
        <p className="fa-q">{L('Quanto tens nesta conta?')}</p>
        <AmountField value={v} onChange={setV} currency={currency} kind="income" signed />
        <div className="tx-rows"><TextRow icon={FI.name} label={L('Nome da conta')} value={name} onChange={setName} placeholder={L('Ex.: Conta do banco')} cls={miss.cls('name')} /></div>
        <button type="button" className="tx-addbtn" disabled={busy} onClick={() => { save().catch(() => setBusy(false)); }} data-testid="first-account">{L('Criar conta e continuar')}</button>
      </div>
    </BottomSheet>
  );
}
