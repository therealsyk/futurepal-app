// Página de uma dívida: sugestões para acabar mais depressa (com base nos gastos da pessoa), simulador e pagamentos feitos.
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/app-db';
import type { Account, Transaction, Transfer } from '../db/database';
import { updateAccount } from '../core/accounts';
import { budget, options, simulate, usualPayment, type Effect } from '../core/debtBoost';
import { joinDesc, payoff, splitDesc } from '../core/debtPlan';
import { duration, endDate, fill } from '../ui/AccountPlan';
import { appConfirm } from '../ui/confirm';
import { CountMoney } from '../ui/CountMoney';
import { Ic, ICON } from '../ui/fx';
import { L } from '../i18n/phrases';

/** Transferências e entradas que serviram para abater uma dívida (ou juntar numa poupança). */
export function accountPayments(a: Account, transfers: Transfer[], txs: Transaction[]): Array<{ id: string; date: string; cents: number; from: string | null; note: string }> {
  return [
    ...transfers.filter((t) => t.deletedAt === null && t.toAccountId === a.id).map((t) => ({ id: t.id, date: t.date, cents: t.amountCents, from: t.fromAccountId, note: t.note })),
    ...txs.filter((t) => t.deletedAt === null && t.accountId === a.id && t.type === 'income').map((t) => ({ id: t.id, date: t.date, cents: t.amountCents, from: null, note: t.description })),
  ].sort((x, y) => y.date.localeCompare(x.date));
}

export function PaymentList({ a, transfers, txs, accounts, money, lang, short = 3 }: { a: Account; transfers: Transfer[]; txs: Transaction[]; accounts: Account[]; money: (c: number) => string; lang: string; short?: number }) {
  const [all, setAll] = useState(false);
  const list = accountPayments(a, transfers, txs), debt = a.type === 'debt';
  if (!list.length) return <p className="fx-muted db-none">{debt ? L('Ainda não abateste nada nesta dívida.') : L('Ainda não juntaste nada nesta conta.')}</p>;
  return (
    <>
      {(all ? list : list.slice(0, short)).map((p) => (
        <div key={p.id} className="gl-line db-line"><span><Ic d="M12 5v14M5 12l7 7 7-7" size={16} /><span><b>{p.note || (debt ? L('Pagamento da dívida') : L('Transferência'))}</b><small>{new Date(p.date + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}{p.from ? ` · ${accounts.find((x) => x.id === p.from)?.name ?? ''}` : ''}</small></span></span><b className="fx-pos">{money(p.cents)}</b></div>
      ))}
      {list.length > short && <button type="button" className="gl-more" onClick={() => setAll(!all)}>{all ? L('Ver menos') : `${L('Ver tudo')} (${list.length})`}</button>}
    </>
  );
}

export function DebtBoost({ a, left, txs, accounts, transfers, balOf, money, lang, reload }: {
  a: Account; left: number; txs: Transaction[]; accounts: Account[]; transfers: Transfer[]; balOf: (a: Account) => number; money: (c: number) => string; lang: string; reload: () => void;
}) {
  const { text, plan } = splitDesc(a.description), rate = plan?.rate ?? 0;
  const base = usualPayment(plan?.monthlyCents ?? 0, a.id, transfers);
  const liquid = accounts.filter((x) => x.type !== 'debt').reduce((s, x) => s + balOf(x), 0);
  const b = budget(txs, transfers, accounts, liquid), opts = base > 0 ? options(left, base, rate, b) : [];
  const nowEnd = base > 0 ? payoff(left, base, rate) : null; // como está hoje: é com isto que as opções se comparam
  const lump = Math.min(b.lumpCents, left), lumpEffect = lump > 0 && base > 0 ? simulate(left, base, rate, lump, base) : null;
  const top = Math.max(base * 3, base + b.extraCents * 2, Math.ceil(left / 24)), step = top > 200000 ? 5000 : 1000;
  const [now, setNow] = useState(0), [per, setPer] = useState<number | null>(null);
  const monthly = per ?? base, sim = monthly > 0 ? simulate(left, base, rate, now, monthly) : null;
  if (left <= 0) return null;
  const gain = (e: Effect) => [e.saveMonths > 0 ? fill(L('menos {m}'), { m: duration(e.saveMonths) }) : '', e.saveInterestCents > 0 ? fill(L('poupas {m} em juros'), { m: money(e.saveInterestCents) }) : ''].filter(Boolean).join(' · ');
  const apply = async (cents: number) => {
    if (!(await appConfirm(fill(L('Passar a abater {m} por mês nesta dívida?'), { m: money(cents) }), { ok: L('Sim'), danger: false }))) return;
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
            <p className="gl-sub">{fill(L('Toca numa opção. Continuas a ter {k} por mês para poupar.'), { k: money(b.keepCents) })}</p>
            {nowEnd && <div className="db-now"><span><small>{L('Agora pagas')}</small><b>{money(base)}<i>/{L('mês')}</i></b></span><Ic d={ICON.right} size={18} /><span><small>{L('Acabas em')}</small><b>{endDate(nowEnd.months, lang)}</b></span></div>}
            {opts.length > 0 && <div className="db-opts">{opts.map((o, i) => (
              <button key={o.extra} type="button" style={{ '--i': i } as CSSProperties} onClick={() => apply(o.monthly)}>
                <small>{names[opts.length === 3 ? i : opts.length === 2 ? i + 1 : 1]}</small><b>{money(o.monthly)}<i>/{L('mês')}</i></b>
                <em>+{money(o.extra)}</em><span>{L('Acabas em')} <strong>{endDate(o.effect.months, lang)}</strong></span><span className="fx-pos">{fill(L('Poupas {m}'), { m: duration(o.effect.saveMonths) })}</span>
              </button>
            ))}</div>}
            {lumpEffect && <div className="db-lump"><span className="pco-mic"><Ic d="M13 2 4 14h7l-1 8 9-12h-7z" size={19} /></span><div><b>{fill(L('Podias pagar já {m}'), { m: money(lump) })}</b><small>{L('Acabas em')} <strong>{endDate(lumpEffect.months, lang)}</strong> · <strong className="fx-pos">{fill(L('Poupas {m}'), { m: duration(lumpEffect.saveMonths) })}</strong></small></div><Link className="gl-act" to={`/transacoes?nova=1&para=${a.id}`}>{L('Abater')}</Link></div>}
          </>}
      </section>
      <section className="mv-card gl-sec db-sim">
        <h2>{L('Simulador')}</h2>
        <p className="gl-sub">{L('Arrasta as bolas e vê quando acabas.')}</p>
        <label><span>{L('Pagar agora')}<b><CountMoney cents={now} money={money} /></b></span><input type="range" min={0} max={left} step={Math.max(1000, Math.round(left / 200 / 1000) * 1000)} value={now} style={{ '--r': `${(now / left) * 100}%` } as CSSProperties} onChange={(e) => setNow(+e.target.value)} /></label>
        <label><span>{L('Abater por mês')}<b><CountMoney cents={monthly} money={money} /></b></span><input type="range" min={0} max={top} step={step} value={monthly} style={{ '--r': `${(monthly / top) * 100}%` } as CSSProperties} onChange={(e) => setPer(+e.target.value)} /></label>
        {sim ? <div className="db-out" key={sim.months}><small>{L('Acabas em')}</small><b>{now >= left ? L('Agora') : endDate(sim.months, lang)}</b>{(sim.saveMonths > 0 || sim.saveInterestCents > 0) && <span className="fx-pos">{gain(sim)}</span>}</div> : <p className="sh-alert">{L('Com este valor a dívida não acaba: escolhe um valor por mês maior.')}</p>}
        {sim && b.months >= 2 && monthly > base + b.extraCents + 100 && <p className="sh-alert">{L('Cuidado: pode faltar-te dinheiro para as contas.')}</p>}
        {sim && per !== null && per !== (plan?.monthlyCents ?? 0) && per > 0 && <button type="button" className="gl-act main db-use" onClick={() => apply(per)}><Ic d="M20 6 9 17l-5-5" size={17} />{fill(L('Usar {m} por mês'), { m: money(per) })}</button>}
      </section>
      <section className="mv-card gl-sec"><h2>{L('Pagamentos feitos')}</h2><PaymentList a={a} transfers={transfers} txs={txs} accounts={accounts} money={money} lang={lang} short={4} /></section>
    </>
  );
}

/** Ligação da caixa da conta para a página completa. */
export function MoreInfo({ id }: { id: string }) {
  return <Link to={`/metas?conta=${id}`} className="gl-act db-more"><Ic d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 11v5M12 8h.01" size={18} />{L('Mais informações')}</Link>;
}
