// Página de uma dívida: sugestões para acabar mais depressa (com base nos gastos da pessoa), simulador e pagamentos feitos.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { db } from '../db/app-db';
import type { Account, Transaction, Transfer } from '../db/database';
import { updateAccount } from '../core/accounts';
import { budget, options, simulate, usualPayment, type Effect } from '../core/debtBoost';
import { joinDesc, payoff, splitDesc } from '../core/debtPlan';
import { duration, endDate, fill } from '../ui/AccountPlan';
import { appConfirm } from '../ui/confirm';
import { CountMoney } from '../ui/CountMoney';
import { SwitchRow } from '../ui/formFields';
import { Ic } from '../ui/fx';
import { L } from '../i18n/phrases';

/** Transferências e entradas que serviram para abater uma dívida (ou juntar numa poupança). */
export function accountPayments(a: Account, transfers: Transfer[], txs: Transaction[]): Array<{ id: string; date: string; cents: number; from: string | null; note: string }> {
  return [
    ...transfers.filter((t) => t.deletedAt === null && t.toAccountId === a.id).map((t) => ({ id: t.id, date: t.date, cents: t.amountCents, from: t.fromAccountId, note: t.note })),
    ...txs.filter((t) => t.deletedAt === null && t.accountId === a.id && t.type === 'income').map((t) => ({ id: t.id, date: t.date, cents: t.amountCents, from: null, note: t.description })),
  ].sort((x, y) => y.date.localeCompare(x.date));
}

/** Linhas no mesmo formato das transações (agrupadas por dia). */
export function DayRows<T extends { id: string; date: string }>({ rows, lang, render }: { rows: T[]; lang: string; render: (r: T) => ReactNode }) {
  const days: Array<[string, T[]]> = [];
  for (const r of rows) { const last = days[days.length - 1]; if (last && last[0] === r.date) last[1].push(r); else days.push([r.date, [r]]); }
  return <>{days.map(([day, rs]) => (
    <div key={day} className="sh-day">
      <div className="sh-dayhead"><b>{new Date(day + 'T12:00:00').toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short', year: day.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' })}</b></div>
      {rs.map(render)}
    </div>
  ))}</>;
}

/** Cabeçalho de uma caixa com o "Ver mais" no canto. */
export function SecHead({ title, more }: { title: string; more?: ReactNode }) {
  return <div className="mv-card-head gl-head"><h2>{title}</h2>{more}</div>;
}

export function PaymentList({ a, transfers, txs, accounts, money, lang, short = 3 }: { a: Account; transfers: Transfer[]; txs: Transaction[]; accounts: Account[]; money: (c: number) => string; lang: string; short?: number }) {
  const list = accountPayments(a, transfers, txs), debt = a.type === 'debt';
  if (!list.length) return <p className="fx-muted db-none">{debt ? L('Ainda não abateste nada nesta dívida.') : L('Ainda não juntaste nada nesta conta.')}</p>;
  return (
    <DayRows rows={list.slice(0, short)} lang={lang} render={(p) => (
      <div key={p.id} className="sh-tx">
        <span className="txs-tric"><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={17} /></span>
        <span className="sh-tx-main"><b>{p.note || (debt ? L('Pagamento da dívida') : L('Transferência'))}</b><small>{p.from ? `${accounts.find((x) => x.id === p.from)?.name ?? ''} → ${a.name}` : a.name}</small></span>
        <b className="fx-pos">+{money(p.cents)}</b>
      </div>
    )} />
  );
}

/** Caixa "Pagamentos feitos" / "Dinheiro que entrou": lista como nas transações e "Ver mais" para as Transações só desta conta. */
export function PaySection({ title, a, transfers, txs, accounts, money, lang, short = 4, inner }: { title: string; a: Account; transfers: Transfer[]; txs: Transaction[]; accounts: Account[]; money: (c: number) => string; lang: string; short?: number; inner?: boolean }) {
  const n = accountPayments(a, transfers, txs).length;
  const body = <>
    <SecHead title={title} more={n > 0 && <Link className="gl-seemore" to={`/transacoes?conta=${a.id}`}>{L('Ver mais')}{n > short ? ` (${n})` : ''}<Ic d="M9 6l6 6-6 6" size={15} /></Link>} />
    <PaymentList a={a} transfers={transfers} txs={txs} accounts={accounts} money={money} lang={lang} short={short} />
  </>;
  return inner ? <div className="db-inbox">{body}</div> : <section className="mv-card gl-sec">{body}</section>;
}

export function DebtBoost({ a, left, txs, accounts, transfers, balOf, money, lang, reload }: {
  a: Account; left: number; txs: Transaction[]; accounts: Account[]; transfers: Transfer[]; balOf: (a: Account) => number; money: (c: number) => string; lang: string; reload: () => void;
}) {
  const { text, plan } = splitDesc(a.description), rate = plan?.rate ?? 0;
  const base = usualPayment(plan?.monthlyCents ?? 0, a.id, transfers);
  const liquid = accounts.filter((x) => x.type !== 'debt').reduce((s, x) => s + balOf(x), 0);
  const [extras, setExtras] = useState(true);
  const b = budget(txs, transfers, accounts, liquid, new Date(), !extras), opts = base > 0 ? options(left, base, rate, b) : [];
  const nowEnd = base > 0 ? payoff(left, base, rate) : null; // como está hoje: é com isto que as opções se comparam
  const lump = Math.min(b.lumpCents, left), lumpEffect = lump > 0 && base > 0 ? simulate(left, base, rate, lump, base) : null;
  const top = Math.max(base * 3, base + b.extraCents * 2, Math.ceil(left / 24), left), step = top > 200000 ? 5000 : 1000;
  const [now, setNow] = useState(0), [per, setPer] = useState<number | null>(null), [ask, setAsk] = useState<{ cents: number; e: Effect } | null>(null);
  const monthly = per ?? base, sim = monthly > 0 ? simulate(left, base, rate, now, monthly) : null;
  if (left <= 0) return null;
  const save = async (cents: number) => {
    await updateAccount(db, a.id, { description: joinDesc(text, { startCents: plan?.startCents ?? Math.max(left, a.initialBalanceCents), rate: plan?.rate, goalId: plan?.goalId, monthlyCents: cents }) });
    setAsk(null); reload();
  };
  const apply = async (cents: number, e?: Effect | null) => {
    if (e && b.months >= 2 && cents > base) { setAsk({ cents, e }); return; }
    const msg = fill(L('Passar a abater {m} por mês nesta dívida?'), { m: money(cents) });
    if (!(await appConfirm(msg, { ok: L('Sim'), danger: false }))) return;
    await updateAccount(db, a.id, { description: joinDesc(text, { startCents: plan?.startCents ?? Math.max(left, a.initialBalanceCents), rate: plan?.rate, goalId: plan?.goalId, monthlyCents: cents }) });
    reload();
  };
  const names = [L('Leve'), L('Equilibrada'), L('Mais rápida')];
  return (
    <>
      <section className="mv-card gl-sec db-tips">
        <h2>{L('Acabar mais depressa')}</h2>
        {b.months < 2 ? <p className="gl-sub">{L('Quando houver dois meses com rendimentos e despesas, aparecem aqui sugestões feitas para ti.')}</p>
          : base <= 0 ? <p className="gl-sub">{L('Define quanto abates por mês em "Ver conta" para veres sugestões.')}</p>
          : opts.length === 0 && !lumpEffect ? <p className="sh-alert">{fill(L('Num mês normal sobram-te cerca de {m}. Por agora não convém abater mais: mantém o valor atual.'), { m: money(b.freeCents) })}</p>
          : <>
            <div className="tx-rows db-extras"><SwitchRow icon="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" label={L('Contar rendimentos extras')} sub={extras ? L('Salário e extras') : L('Só o salário')} on={extras} onChange={setExtras} /></div>
            {(() => { const spend = b.spendCents + b.debtCents, inc = Math.max(1, b.incomeCents), sp = Math.min(100, (spend / inc) * 100); return (
              <div className="db-flow2" key={String(extras)}>
                <div className="db-f in" style={{ '--i': 0 } as CSSProperties}><span className="db-fi"><Ic d="M12 19V5M5 12l7-7 7 7" size={16} /></span><small>{L('Recebes')}</small><b><CountMoney cents={b.incomeCents} money={money} /></b></div>
                <span className="db-op">−</span>
                <div className="db-f out" style={{ '--i': 1 } as CSSProperties}><span className="db-fi"><Ic d="M12 5v14M5 12l7 7 7-7" size={16} /></span><small>{L('Gastas')}</small><b><CountMoney cents={spend} money={money} /></b></div>
                <span className="db-op">=</span>
                <div className="db-f left" style={{ '--i': 2 } as CSSProperties}><span className="db-fi"><Ic d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" size={16} /></span><small>{L('Sobra')}</small><b><CountMoney cents={b.freeCents} money={money} /></b></div>
                <div className="db-fbar" aria-hidden="true"><i style={{ width: `${sp}%` }} /><em style={{ width: `${100 - sp}%` }} /></div>
                <p className="db-fcap">{fill(L('Gastas {p}% do que recebes; sobram {q}%.'), { p: String(Math.round(sp)), q: String(Math.max(0, 100 - Math.round(sp))) })}</p>
              </div>); })()}
            <p className="gl-sub">{L('As sugestões usam só uma parte do que te sobra, para nunca ficares apertado. Toca numa para ver o que muda.')}</p>
            {nowEnd && <div className="db-now"><span><small>{L('Agora pagas')}</small><b>{money(base)}<i>/{L('mês')}</i></b></span><span className="db-now-arrow" aria-hidden="true">→</span><span><small>{L('Acabas em')}</small><b>{endDate(nowEnd.months, lang)}</b></span></div>}
            {opts.length > 0 && <p className="db-pick">{L('Escolhe quanto queres pagar por mês:')}</p>}
            {opts.length > 0 && <div className="db-opts">{opts.map((o, i) => (
              <button key={o.extra} type="button" style={{ '--i': i } as CSSProperties} onClick={() => apply(o.monthly, o.effect)}>
                <small>{names[opts.length === 3 ? i : opts.length === 2 ? i + 1 : 1]}</small><b>{money(o.monthly)}<i>/{L('mês')}</i></b>
                <em>+{money(o.extra)}</em><span>{L('Acabas em')} <strong>{endDate(o.effect.months, lang)}</strong></span><span className="fx-pos">{fill(L('Poupas {m}'), { m: duration(o.effect.saveMonths) })}</span>
              </button>
            ))}</div>}
            {lumpEffect && <div className="db-lump"><span className="pco-mic"><Ic d="M13 2 4 14h7l-1 8 9-12h-7z" size={19} /></span><div><b>{fill(L('Podias pagar já {m}'), { m: money(lump) })}</b><small>{L('Acabas em')} <strong>{endDate(lumpEffect.months, lang)}</strong> · <strong className="fx-pos">{fill(L('Poupas {m}'), { m: duration(lumpEffect.saveMonths) })}</strong></small><small>{L('Ficas com')} <strong className="db-gold">{money(Math.max(0, liquid - lump))}</strong> {L('de poupanças')} <s>{money(liquid)}</s>{lumpEffect.saveInterestCents > 0 && <> · <strong className="fx-pos">{fill(L('menos {m} em juros'), { m: money(lumpEffect.saveInterestCents) })}</strong></>}</small><small className="db-note">{L('Continuas com dinheiro para 3 meses de despesas.')}</small></div><Link className="gl-act" to={`/transacoes?nova=1&para=${a.id}`}>{L('Abater')}</Link></div>}
          </>}
      </section>
      {ask && createPortal(<div className="spi-back" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setAsk(null); }}><div className="spi-card db-ask" role="dialog" aria-modal="true" aria-label={L('Confirmar')}>
        <span className="on-logo sm"><Ic d="M13 2 4 14h7l-1 8 9-12h-7z" size={30} /></span>
        <h2>{fill(L('Passar a pagar {m} por mês?'), { m: '' })}<b className="db-gold">{money(ask.cents)}</b></h2>
        <div className="db-ask-rows">
          <div style={{ '--i': 0 } as CSSProperties}><span className="pco-mic good"><Ic d="M5 12l4 4L19 6" size={18} /></span><p>{L('Acabas em')} <b>{endDate(ask.e.months, lang)}</b><small className="fx-pos">{fill(L('{t} mais cedo'), { t: duration(ask.e.saveMonths) })}</small></p></div>
          {ask.e.saveInterestCents > 0 && <div style={{ '--i': 1 } as CSSProperties}><span className="pco-mic good"><Ic d="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" size={18} /></span><p>{L('Poupas em juros')} <b className="fx-pos">{money(ask.e.saveInterestCents)}</b></p></div>}
          <div style={{ '--i': 2 } as CSSProperties}><span className="pco-mic gold"><Ic d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2" size={18} /></span><p>{L('Fica para poupar por mês')} <b className="db-gold">{money(Math.max(0, b.freeCents - Math.max(0, ask.cents - base)))}</b><small><s>{money(b.freeCents)}</s></small></p></div>
        </div>
        <button type="button" className="ob-cta lg-go" onClick={() => { save(ask.cents).catch(() => {}); }}>{L('Sim, passar a pagar')}<Ic d="M5 12h14M13 6l6 6-6 6" size={18} /></button>
        <button type="button" className="on-skip" onClick={() => setAsk(null)}>{L('Agora não')}</button>
      </div></div>, document.body)}
      {/* Como pagas e quando acabas: o valor de hoje em cima; aumentar a prestação e/ou abater já mexem na data */}
      <section className="mv-card gl-sec db-sim db-plan2">
        <h2>{L('Quando acabas')}</h2>
        {nowEnd && <div className="dp-now"><div><small>{L('Agora pagas')}</small><b>{money(base)}<i>/{L('mês')}</i></b></div><Ic d="M5 12h14M13 6l6 6-6 6" size={18} /><div><small>{L('Acabas em')}</small><b>{endDate(nowEnd.months, lang)}</b></div></div>}
        <div className="dp-ctl">
          <div className="dp-row"><span>{L('Pagar por mês')}</span>
            <div className="dp-step"><button type="button" aria-label={L('Menos')} onClick={() => setPer(Math.max(step, monthly - step))}>−</button><b><CountMoney cents={monthly} money={money} /></b><button type="button" aria-label={L('Mais')} onClick={() => setPer(Math.min(top, monthly + step))}>+</button></div></div>
          <input type="range" min={0} max={top} step={step} value={monthly} style={{ '--f': Math.min(1, monthly / top) } as CSSProperties} onChange={(e) => setPer(+e.target.value)} aria-label={L('Pagar por mês')} />
          {monthly !== base && base > 0 && <small className={'dp-diff ' + (monthly > base ? 'up' : 'down')}>{monthly > base ? '+' : '−'}{money(Math.abs(monthly - base))} {L('por mês do que hoje')}</small>}
        </div>
        <div className={'dp-ctl dp-lump' + (now > 0 ? ' on' : '')}>
          <div className="tx-rows"><SwitchRow icon="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" label={L('Abater já um valor')} sub={now > 0 ? undefined : lump > 0 ? fill(L('Podias abater cerca de {m} sem ficares apertado'), { m: money(lump) }) : L('Pagar uma parte de uma vez')} on={now > 0} onChange={(v) => setNow(v ? Math.max(step, lump || Math.round(left / 10 / 1000) * 1000) : 0)} /></div>
          {now > 0 && <>
            <div className="dp-row"><span>{L('Valor a abater')}</span><b><CountMoney cents={now} money={money} /></b></div>
            <input type="range" min={0} max={left} step={Math.max(1000, Math.round(left / 200 / 1000) * 1000)} value={now} style={{ '--f': now / left } as CSSProperties} onChange={(e) => setNow(+e.target.value)} aria-label={L('Valor a abater')} />
          </>}
        </div>
        {sim ? (() => {
          const diff = nowEnd ? nowEnd.months - sim.months : 0;
          return <div className={'dp-out ' + (diff > 0 ? 'good' : diff < 0 ? 'bad' : 'same')} aria-live="polite">
            <div><small>{L('Passas a acabar em')}</small><b key={sim.months}>{now >= left ? L('Agora') : endDate(sim.months, lang)}</b></div>
            {diff !== 0 && <em>{diff > 0 ? fill(L('{t} mais cedo'), { t: duration(diff) }) : fill(L('{t} mais tarde'), { t: duration(-diff) })}</em>}
            {sim.saveInterestCents > 0 && <span className="fx-pos">{fill(L('poupas {m} em juros'), { m: money(sim.saveInterestCents) })}</span>}
            {nowEnd && <div className="dp-track" aria-hidden="true"><i style={{ width: `${Math.min(100, (sim.months / Math.max(sim.months, nowEnd.months)) * 100)}%` }} /><span style={{ left: `${Math.min(100, (nowEnd.months / Math.max(sim.months, nowEnd.months)) * 100)}%` }} /></div>}
          </div>; })() : <p className="sh-alert">{L('Com este valor a dívida não acaba: escolhe um valor por mês maior.')}</p>}
        {sim && b.months >= 2 && monthly > base + b.extraCents + 100 && <p className="sh-alert">{L('Cuidado: pode faltar-te dinheiro para as contas.')}</p>}
        {sim && per !== null && per !== (plan?.monthlyCents ?? 0) && per > 0 && <button type="button" className="gl-act main db-use" onClick={() => apply(per, sim)}><Ic d="M20 6 9 17l-5-5" size={17} />{fill(L('Usar {m} por mês'), { m: money(per) })}</button>}
        {(per !== null || now > 0) && <button type="button" className="dp-reset" onClick={() => { setPer(null); setNow(0); }}>{L('Voltar ao valor atual')}</button>}
      </section>
      <PaySection title={L('Pagamentos feitos')} a={a} transfers={transfers} txs={txs} accounts={accounts} money={money} lang={lang} short={4} />
    </>
  );
}

/** Ligação da caixa da conta para a página completa. */
export function MoreInfo({ id }: { id: string }) {
  return <Link to={`/metas?conta=${id}`} className="gl-act db-more"><Ic d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 11v5M12 8h.01" size={18} />{L('Mais informações')}</Link>;
}
