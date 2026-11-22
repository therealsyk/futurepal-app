// Poupanças e dívidas: a caixa da conta (total, o que já foi, o que falta, quando acaba) e o resumo usado no widget.
import { Ic } from './fx';
import { CountMoney } from './CountMoney';
import { GoalRing } from './GoalRing';
import { WidgetRow } from './WidgetRow';
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

export function AccountPlanBox({ a, p, money, lang, onEdit }: { a: Account; p: PlanInfo; money: (c: number) => string; lang: string; onEdit: () => void }) {
  const debt = a.type === 'debt', text = splitDesc(a.description).text, left = p.left, monthLeft = Math.max(0, p.monthly - p.inMonth);
  const tile = (label: string, value: string, sub?: string, cls = '') => <div className="pl-tile"><small>{label}</small><b className={cls}>{value}</b>{sub && <em>{sub}</em>}</div>;
  return (
    <section className="mv-card debt-plan">
      {text && <p className="acc-desc">{text}</p>}
      {p.total > 0 && left === 0 ? <p className="debt-done">{debt ? L('Dívida paga! 🎉') : L('Objetivo atingido 🎉')}</p> : <>
        {p.total > 0 && <>
          <div className="pl-bar"><i style={{ width: `${Math.max(2, p.ratio * 100)}%` }} /><span>{pct(p.ratio)}%</span></div>
          <div className="pl-tiles">
            {tile(debt ? L('Valor total da dívida') : L('Objetivo'), money(p.total))}
            {tile(debt ? L('Já abateste') : L('Já tens'), money(p.done), undefined, 'fx-pos')}
            {tile(debt ? L('Falta abater') : L('Falta juntar'), money(left), p.payable !== null && p.rate > 0 ? fill(L('{m} com juros'), { m: money(p.payable) }) : undefined, debt ? 'fx-neg' : '')}
            {tile(debt ? L('Termina em') : L('Chegas lá em'), p.months === null ? '—' : endDate(p.months, lang), p.months === null ? (p.monthly > 0 ? L('O valor só dá para os juros') : undefined) : fill(L('faltam {m}'), { m: duration(p.months) }))}
          </div>
        </>}
        {p.monthly > 0 && <div className={'pl-month' + (monthLeft === 0 ? ' ok' : '')}>
          <span><b>{L('Este mês')}</b><small>{monthLeft === 0 ? L('Feito ✓') : fill(debt ? L('Falta abater {m}') : L('Falta juntar {m}'), { m: money(monthLeft) })}</small></span>
          <b>{money(p.inMonth)} <small>/ {money(p.monthly)}</small></b>
        </div>}
        {p.rate > 0 && p.payable !== null && <p className="pl-note">{fill(L('Juros de {r}% por ano: ainda vais pagar {m} só de juros.'), { r: String(p.rate).replace('.', ','), m: money(p.payable - left) })}</p>}
        {p.deadline && <p className={'pl-note ' + (p.onTime === null ? '' : p.onTime ? 'fx-pos' : 'fx-neg')}>{p.onTime === null ? `${L('Data limite')}: ` : ''}{p.onTime === null ? new Date(p.deadline + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }) : fill(p.onTime ? L('Vais a tempo: {d}') : L('⚠ A este ritmo não chegas até {d}'), { d: new Date(p.deadline + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>}
      </>}
      <div className="debt-btns">
        <button type="button" className="sh-btn out sm" onClick={onEdit}>{L('Alterar')}</button>
        <Link to={`/transacoes?nova=1&para=${a.id}`} className="sh-btn in sm">{debt ? L('Abater') : L('Juntar')}</Link>
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
