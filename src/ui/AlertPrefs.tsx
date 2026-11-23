// Preferências dos avisos (um só sítio, aberto a partir do sino ou do Planeamento).
import { useState } from 'react';
import { ALERT_KINDS, loadAlertPrefs, saveAlertPrefs, type AlertKind, type AlertPrefs } from '../core/planningAlerts';
import { parseMoneyToCents } from '../core/money';
import { L } from '../i18n/phrases';
import { SwitchRow } from './formFields';
import { BottomSheet } from '../pages/SimplePages';

export const ALERT_LABEL: Record<AlertKind, string> = {
  planning: 'Planeamento do mês', lowBalance: 'Saldo previsto baixo', payment: 'Pagamentos próximos', annual: 'Despesas anuais', budget: 'Limites de categoria',
  goal: 'Metas', debt: 'Dívidas', groups: 'Grupos partilhados',
};

export function AlertPrefsSheet({ onClose }: { onClose: () => void }) {
  return <BottomSheet title={L('Preferências de avisos')} onClose={onClose}><AlertPrefsPanel /></BottomSheet>;
}

/** Painel das preferências (Definições). */
const KIND_IC: Record<AlertKind, [string, string]> = {
  planning: ['M3 17l6-6 4 4 8-8M14 7h7v7', 'Quando começa um mês novo, para planeares o seguinte'],
  lowBalance: ['M12 8v5M12 16h.01M12 3l9 16H3z', 'Avisa se a previsão mostrar o saldo a ficar baixo'],
  payment: ['M5 5h14v15H5zM5 10h14M8 3v4M16 3v4', 'Pagamentos recorrentes e prestações que estão a chegar'],
  annual: ['M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15', 'Seguros e outras despesas de uma vez por ano'],
  budget: ['M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z', 'Quando chegas perto do limite de uma categoria'],
  goal: ['M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8', 'Prazo a chegar e metas concluídas'],
  debt: ['M3 10l9-6 9 6M5 10v9h14v-9', 'Última prestação e dívidas pagas'],
  groups: ['M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', 'O que tens por pagar nos grupos partilhados'],
};

/** Painel das preferências (Definições > Avisos). */
export function AlertPrefsPanel() {
  const [p, setP] = useState<AlertPrefs>(loadAlertPrefs);
  const set = (n: AlertPrefs) => { setP(n); saveAlertPrefs(n); };
  const chips = (vals: number[], all: number[], unit: string, key: 'budgetTiers' | 'annualDays') => (
    <div className="ap-chips">{all.map((v) => { const on = vals.includes(v); return <button key={v} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => set({ ...p, [key]: on ? vals.filter((x) => x !== v) : [...vals, v].sort((a, b) => a - b) })}>{v}{unit}</button>; })}</div>
  );
  return (
    <div className="ap2">
      <h3 className="ap2-h">{L('O que te avisamos')}</h3>
      <div className="tx-rows ap2-rows">{ALERT_KINDS.map((k) => (
        <SwitchRow key={k} icon={KIND_IC[k][0]} label={L(ALERT_LABEL[k])} sub={L(KIND_IC[k][1])} on={p.on[k]} onChange={(v) => set({ ...p, on: { ...p.on, [k]: v } })} />
      ))}</div>
      <h3 className="ap2-h">{L('Sugestões')}</h3>
      <div className="tx-rows ap2-rows"><SwitchRow icon="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" label={L('Sugestões de poupança')} sub={L('Dizer quanto poupavas sem subscrições e outros pagamentos não essenciais')} on={p.savingTips} onChange={(v) => set({ ...p, savingTips: v })} /></div>
      <h3 className="ap2-h">{L('Quando avisar')}</h3>
      <div className="ap2-card">
        <span className="ap2-lbl">{L('Pagamentos: avisar com')}</span>
        <div className="sh-seg small three">{[1, 3, 7].map((d) => <button key={d} type="button" className={p.advanceDays === d ? 'on' : ''} onClick={() => set({ ...p, advanceDays: d })}>{d} {d === 1 ? L('dia') : L('dias')}</button>)}</div>
        <span className="ap2-lbl">{L('Despesas anuais: avisar antes')}</span>
        {chips(p.annualDays, [30, 60, 90], ' ' + L('dias'), 'annualDays')}
        <span className="ap2-lbl">{L('Limites: patamares')}</span>
        {chips(p.budgetTiers, [50, 80, 100], '%', 'budgetTiers')}
        <span className="ap2-lbl">{L('Avisar se o saldo previsto ficar abaixo de')}</span>
        <input className="fx-input ap2-in" inputMode="decimal" defaultValue={p.lowBalanceCents ? String(p.lowBalanceCents / 100).replace('.', ',') : ''} placeholder={L('0 (só quando ficar negativo)')} onBlur={(e) => set({ ...p, lowBalanceCents: Math.max(0, parseMoneyToCents(e.target.value || '0') ?? 0) })} aria-label={L('Saldo baixo')} />
      </div>
      <p className="ap2-note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 16v-4M12 8h.01" /></svg>{L('Os avisos aparecem no sino, dentro da app. Notificações do telemóvel/computador com a app fechada ainda não estão disponíveis.')}</p>
    </div>
  );
}
