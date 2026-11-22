// Poupanças e dívidas: a caixa da conta (total, o que já foi, o que falta, quando acaba) e o resumo usado no widget.
import { Ic } from './fx';
import { CountMoney } from './CountMoney';
import { GoalRing } from './GoalRing';
import { WidgetRow } from './WidgetRow';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Account } from '../db/database';
import { splitDesc, type PlanInfo } from '../core/debtPlan';
import { L } from '../i18n/phrases';

export const fill = (txt: string, v: Record<string, string>) => txt.replace(/\{(\w)\}/g, (_, x: string) => v[x] ?? '');
const pct = (r: number) => Math.floor(r * 100 + 1e-9);

export function endDate(months: number, lang: string, now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth() + months, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
}
/** "10 anos e 4 meses" */
export function duration(months: number): string {
  const y = Math.floor(months / 12), mo = months % 12;
  return [y ? `${y} ${y === 1 ? L('ano') : L('anos')}` : '', mo ? `${mo} ${mo === 1 ? L('mês') : L('meses')}` : ''].filter(Boolean).join(` ${L('e')} `) || L('este mês');
}
export const endText = (months: number, lang: string) => fill(L('Acabas em {d} (faltam {m})'), { d: endDate(months, lang), m: duration(months) });

export function AccountPlanBox({ a, p, money, lang, onEdit, children, more }: { children?: ReactNode; more?: ReactNode; a: Account; p: PlanInfo; money: (c: number) => string; lang: string; onEdit: () => void }) {
  const debt = a.type === 'debt', text = splitDesc(a.description).text, left = p.left, monthLeft = Math.max(0, p.monthly - p.inMonth);
  // caixa simples: ícone, o que é e o valor (como nos grupos e nos limites)
  const tile = (d: string, label: string, value: ReactNode, tone = '') => <div className={'gx-tile ' + tone}><span aria-hidden="true"><Ic d={d} size={20} /></span><div><small>{label}</small><b>{value}</b></div></div>;
  const FLAG = 'M6 21V4h11l-2 4 2 4H6', CAL = 'M5 5h14v15H5zM5 10h14M8 3v4M16 3v4', PCT = 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z';
  return (
    <section className="mv-card debt-plan ap-box">
      {text && <p className="acc-desc">{text}</p>}
      {p.total > 0 && left === 0 ? <p className="debt-done">{debt ? L('Dívida paga! 🎉') : L('Objetivo atingido 🎉')}</p> : <>
        {p.total > 0 && <div className="ap-top">
          <GoalRing r={p.ratio} size={128} debt={debt}><b>{pct(p.ratio)}%</b><small>{debt ? L('pago') : L('completo')}</small></GoalRing>
          <div className="gl-have"><small>{debt ? L('Falta pagar') : L('Falta juntar')}</small><b className={debt ? 'fx-neg' : ''}><CountMoney cents={left} money={money} /></b><small>{L('de')} {money(p.total)}</small></div>
        </div>}
        <div className="gx-tiles ap-tiles">
          {tile('M20 6 9 17l-5-5', debt ? L('Já pagaste') : L('Já tens'), <CountMoney cents={p.done} money={money} />, 'pos')}
          {p.total > 0 && tile(FLAG, debt ? L('Acabas em') : L('Chegas lá em'), p.months === null ? '—' : endDate(p.months, lang))}
          {p.monthly > 0 && tile(CAL, L('Este mês'), monthLeft === 0 ? L('Feito ✓') : `${money(p.inMonth)} / ${money(p.monthly)}`, monthLeft === 0 ? 'pos' : '')}
          {p.rate > 0 && p.payable !== null && tile(PCT, L('Juros que faltam'), money(p.payable - left))}
        </div>
        {p.monthly > 0 && p.months === null && debt && <p className="pl-note fx-neg">{L('O valor só dá para os juros')}</p>}
        {p.deadline && <p className={'pl-note ' + (p.onTime === null ? '' : p.onTime ? 'fx-pos' : 'fx-neg')}>{L('Data limite')}: {new Date(p.deadline + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' })}{p.onTime === null ? '' : ' · ' + (p.onTime ? L('A tempo') : L('Atrasada'))}</p>}
      </>}
      {children}
      <div className="ap-acts">
        <Link to={`/transacoes?nova=1&para=${a.id}`} className="gl-act main"><Ic d="M7 7h12l-3-3M17 17H5l3 3" size={18} />{debt ? L('Abater') : L('Juntar')}</Link>
        {more}
        <button type="button" className="gl-act" onClick={onEdit}><Ic d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" size={18} />{L('Alterar')}</button>
      </div>
    </section>
  );
}

/** Linha do widget: nome, barra e quando termina. */
export function PlanLine({ a, p, money, lang, i = 0 }: { i?: number; a: Account; p: PlanInfo; money: (c: number) => string; lang: string }) {
  const debt = a.type === 'debt';
  return (
    <WidgetRow to="/contas" i={i} title={a.name} pic={p.total > 0 ? <GoalRing r={p.ratio} size={58} debt={debt} /> : <span className={'wr-ic t-' + a.type}><Ic d="M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2z" size={24} /></span>}
      sub={p.total > 0 && p.left === 0 ? (debt ? L('Dívida paga! 🎉') : L('Objetivo atingido 🎉')) : p.months !== null && p.months > 0 ? `${debt ? L('Termina em') : L('Chegas lá em')} ${endDate(p.months, lang)}` : p.total > 0 ? `${money(p.done)} ${L('de')} ${money(p.total)}` : undefined}
      value={p.total > 0 ? (p.left > 0 ? <CountMoney cents={p.left} money={money} /> : '✓') : <CountMoney cents={p.done} money={money} />} tone={p.total > 0 && p.left > 0 && debt ? 'fx-neg' : 'fx-pos'} />
  );
}

/** Widget de uma só conta: barra grande, quanto falta e quando termina. */
export function PlanOne({ a, p, money, lang }: { a: Account; p: PlanInfo; money: (c: number) => string; lang: string }) {
  const debt = a.type === 'debt';
  if (!p.total) return <div className="pl-one"><div className="pl-tile"><small>{L('Já tens')}</small><b>{money(p.done)}</b></div></div>;
  return (
    <div className={'pl-one ' + a.type}>
      <span className="pl-ring"><GoalRing r={p.ratio} size={120} debt={debt}><b>{pct(p.ratio)}%</b></GoalRing></span>
      <div className="pl-bar"><i style={{ width: `${Math.max(2, p.ratio * 100)}%` }} /><span>{pct(p.ratio)}%</span></div>
      <div className="pl-tiles">
        <div className="pl-tile"><small>{debt ? L('Já abateste') : L('Já tens')}</small><b className="fx-pos">{money(p.done)}</b></div>
        <div className="pl-tile"><small>{debt ? L('Falta abater') : L('Falta juntar')}</small><b className={debt ? 'fx-neg' : ''}>{money(p.left)}</b></div>
        <div className="pl-tile wide"><small>{debt ? L('Termina em') : L('Chegas lá em')}</small><b>{p.left === 0 ? L('Feito ✓') : p.months === null ? '—' : endDate(p.months, lang)}</b></div>
      </div>
    </div>
  );
}
