// Campos comuns dos formulários (valor, descrição, conta, data, recorrência, interruptores).
// Todos os formulários usam estes: mudar aqui muda em todo o lado (Transações, Extras, Contas, Metas, Grupos).
import { useState, type ReactNode } from 'react';
import { parseContact } from '../core/split';
import { useTranslation } from 'react-i18next';
import { RECURRING_FREQUENCIES } from '../core/finance';
import type { Category, RecurringFrequency } from '../db/database';
import { DatePicker } from './DatePicker';
import { CategorySelect, Ic, ICON, PickMenu } from './fx';
import { L } from '../i18n/phrases';

export const FI = {
  name: 'M4 7h16v12H4zM4 7l3-3h10l3 3', desc: 'M4 20h4L19 9l-4-4L4 16z', month: 'M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a5 5 0 1 0 1 6',
  pct: 'M19 5L5 19M7.5 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', date: 'M5 5h14v15H5zM5 10h14M9 3v4M15 3v4', track: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  target: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z', money: 'M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', cat: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', swap: 'M4 7h13l-3-3M20 17H7l3 3',
};
export const onlyDigits = (v: string) => v.replace(/[^\d.,]/g, '');

/** Valor grande com a moeda por baixo. Numa transação: despesa a vermelho e com "−", rendimento a verde (o valor guardado não muda). */
export function AmountField({ value, onChange, currency, label, cls = '', autoFocus, kind, signed, onCurrency }: { onCurrency?: () => void; value: string; onChange: (v: string) => void; currency: string; label?: string; cls?: string; autoFocus?: boolean; kind?: 'expense' | 'income'; signed?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <input className={'tx-amt' + (kind ? ' k-' + kind : '') + cls} autoFocus={autoFocus} inputMode="decimal" value={kind === 'expense' && value ? '−' + value : value} placeholder="0" onChange={(e) => onChange(signed ? e.target.value.replace(/[^\d.,-]/g, '') : onlyDigits(e.target.value))} aria-label={label ?? t('transactions.amount')} />
      {onCurrency ? <button type="button" className="tx-cur tx-curbtn" onClick={onCurrency}>{currency}<Ic d={ICON.down} size={14} /></button> : <span className="tx-cur">{label ? `${label} · ${currency}` : currency}</span>}
    </>
  );
}

/** Linha com ícone e nome à esquerda e o campo à direita. */
export function Row({ icon, label, cls = '', children, div }: { icon: string; label: string; cls?: string; children: ReactNode; div?: boolean }) {
  const inner = <><span><Ic d={icon} size={18} />{label}</span>{children}</>;
  return div ? <div className={'tx-row' + cls}>{inner}</div> : <label className={'tx-row' + cls}>{inner}</label>;
}

export function TextRow({ icon = FI.desc, label, value, onChange, placeholder = L('Opcional'), cls, money }: { icon?: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; cls?: string; money?: boolean }) {
  return <Row icon={icon} label={label} cls={cls}><input className="tx-val" inputMode={money ? 'decimal' : undefined} maxLength={money ? 16 : 120} value={value} placeholder={placeholder} onChange={(e) => onChange(money ? onlyDigits(e.target.value) : e.target.value)} /></Row>;
}

export function DateRow({ label, value, onChange, allowEmpty, cls, testId }: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean; cls?: string; testId?: string }) {
  return <Row div icon={FI.date} label={label} cls={cls}><DatePicker value={value} onChange={onChange} allowEmpty={allowEmpty} ariaLabel={label} testId={testId} /></Row>;
}

/** Conta e saldo numa só peça. */
export function AccountRow({ icon = ICON.wallet, label, value, options, balance, owed, onChange, cls = '', children }: {
  icon?: string; label: string; value: string; options: Array<{ id: string; name: string; sub?: string; right?: string }>; balance?: string; owed?: boolean; onChange: (id: string) => void; cls?: string; children?: ReactNode;
}) {
  return (
    <Row div icon={icon} label={label} cls={' tx-acc' + cls}>
      <span className="tx-accval"><span className="tx-accpick">
        <PickMenu compact label={label} value={value} options={options.map((a) => ({ value: a.id, label: a.name, sub: a.sub, right: a.right }))} onChange={(v) => onChange(String(v))} />
        {balance !== undefined && <small className={owed || balance.startsWith('-') || balance.startsWith('−') ? 'fx-neg' : 'fx-pos'}>{balance}</small>}
      </span>{children}</span>
    </Row>
  );
}

/** Interruptor; ligado, pode ter um campo na própria linha. */
export function SwitchRow({ icon, label, sub, on, onChange, cls = '', children }: { icon: string; label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; cls?: string; children?: ReactNode }) {
  return (
    <div className={'tx-row' + cls}><span><Ic d={icon} size={18} /><span className="acc-lbl">{label}{sub && <small>{sub}</small>}</span></span>
      {on && children && <span className="acc-in">{children}</span>}
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={'ob-toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}><i /></button></div>
  );
}

/** Recorrente: interruptor, frequência e quando termina. */
export function RepeatRows({ label = L('Recorrente'), on, setOn, freq, setFreq, end, setEnd }: { label?: string; on: boolean; setOn: (v: boolean) => void; freq: RecurringFrequency; setFreq: (f: RecurringFrequency) => void; end: string; setEnd: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <SwitchRow icon={FI.month} label={label} on={on} onChange={setOn} />
      {on && <>
        <div className="tx-row tx-sub"><span>{t('goals.frequency')}</span><PickMenu compact label={t('goals.frequency')} value={freq} options={RECURRING_FREQUENCIES.map((f) => ({ value: f, label: t('goals.' + f) }))} onChange={(v) => setFreq(v as RecurringFrequency)} /></div>
        <div className="tx-row tx-sub"><span>{L('Termina em')}</span><DatePicker value={end} onChange={setEnd} allowEmpty ariaLabel={L('Termina em')} /></div>
      </>}
    </>
  );
}

/** Convidar por email ou telemóvel: cada contacto vira uma etiqueta (Enter, vírgula ou sair do campo). */
export function InviteRow({ value, onChange, cls = '' }: { value: string[]; onChange: (v: string[]) => void; cls?: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const commit = () => { const v = draft.trim().replace(/,$/, ''); if (!v || !parseContact(v)) return; if (!value.includes(v)) onChange([...value, v]); setDraft(''); };
  return (
    <div className={'tx-row sp-invrow' + cls}><span><Ic d="M4 6h16v12H4zM4 7l8 6 8-6" size={18} />{L('Convidar')}</span>
      <div className="sp-chips">
        {value.map((c) => <span key={c} className="sp-chip">{c}<button type="button" aria-label={t('common.delete')} onClick={() => onChange(value.filter((x) => x !== c))}>×</button></span>)}
        <input className={'tx-val sp-chipin' + (draft.trim() && !parseContact(draft) ? ' bad' : '')} value={draft} inputMode="email" placeholder={value.length ? L('Adicionar outro') : t('split.invitePh')} aria-label={t('split.inviteLabel')}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && draft.trim()) { e.preventDefault(); commit(); } else if (e.key === 'Backspace' && !draft) onChange(value.slice(0, -1)); }} />
      </div></div>
  );
}

/** Categoria: a mesma linha e a mesma lista em todo o lado. Vazia, mostra "Escolher…". */
export function CategoryRow({ cats, kind, value, onChange, cls, required }: { cats: Category[]; kind: 'expense' | 'income'; value: string; onChange: (v: string) => void; cls?: string; required?: boolean }) {
  const { t } = useTranslation();
  return <Row div icon={FI.cat} label={t('transactions.category')} cls={cls}><CategorySelect cats={cats} kind={kind} value={value} onChange={onChange} ariaLabel={t('transactions.category')} emptyLabel={required ? L('Escolher…') : undefined} className="fx-input tx-val" /></Row>;
}
