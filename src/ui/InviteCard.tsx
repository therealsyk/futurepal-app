// Convite para dividir despesas: o mesmo cartão nas notificações e no aviso.
import { Ic } from './fx';
import { L } from '../i18n/phrases';

export interface InviteInfo { id: string; by: string; group: string }
export const INVITE_IC = 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6';

export function InviteCard({ inv, busy, onAnswer }: { inv: InviteInfo; busy: boolean; onAnswer: (accept: boolean) => void }) {
  return (
    <div className="nt-card invite">
      <span className="nt-ic"><Ic d={INVITE_IC} size={18} /></span>
      <div className="nt-body">
        <small>{L('Convite para dividir despesas')}</small>
        <b>{inv.group}</b>
        <p>{L('Convidado por')} {inv.by}</p>
        <div className="nt-btns"><button type="button" className="no" disabled={busy} onClick={() => onAnswer(false)}>{L('Rejeitar')}</button><button type="button" className="yes" disabled={busy} onClick={() => onAnswer(true)}>{L('Aceitar')}</button></div>
      </div>
    </div>
  );
}
