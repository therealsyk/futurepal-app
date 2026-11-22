// Widgets extra do Resumo do PC (Personalizar > Adicionar widget): contas, limites do mês e assistente.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Budget, Category, Transfer } from '../db/database';
import { accountBalanceCents } from '../core/accounts';
import { planInfo, splitDesc, type PlanInfo } from '../core/debtPlan';
import { PlanLine, PlanOne } from '../ui/AccountPlan';
import { loadSettings } from '../core/settings';
import { Ic, CatIcon, catLabel } from '../ui/fx';
import { CountMoney } from '../ui/CountMoney';
import { GoalRing } from '../ui/GoalRing';
import { WidgetEmpty, WidgetRow, WidgetTop } from '../ui/WidgetRow';
import { L } from '../i18n/phrases';

const live = <T extends { deletedAt: string | null }>(r: T[]) => r.filter((x) => x.deletedAt === null);
const WALLET = 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2';
const ACC_IC: Record<string, string> = { savings: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2z', debt: 'M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5' };
const LIMIT = 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2';
const SPARK = 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z';
const SEND = 'M4 12l16-8-6 16-2-7z';

function Head({ icon, title, to, link }: { icon: string; title: string; to: string; link: string }) {
  return <div className="pco-mhead"><span className="pco-mic"><Ic d={icon} size={18} /></span><h3>{title}</h3><Link to={to} className="mv-link">{link}</Link></div>;
}

export function AccountsWidget({ money }: { money: (c: number) => string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<{ a: Account; bal: number }>>([]);
  useEffect(() => {
    (async () => {
      const accs = live(await db.accounts.toArray()), txs = live(await db.transactions.toArray());
      const trs = live(await db.transfers.toArray()) as Transfer[], sals = live(await db.salaries.toArray());
      const n = new Date();
      const sal = sals.filter((x) => x.year * 100 + x.month <= n.getFullYear() * 100 + n.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
      setRows(accs.map((a) => ({ a, bal: accountBalanceCents(a, txs, accs, sal, trs) })));
    })().catch(() => {});
  }, []);
  return (
    <section className="mv-card pco-w">
      <Head icon={WALLET} title={t('pco.accounts')} to="/contas" link={t('blk.seeAll')} />
      {rows.length > 0 && (() => { const tot = rows.filter((x) => x.a.type !== 'debt').reduce((a, x) => a + x.bal, 0); return <WidgetTop label={L('Dinheiro nas contas')} value={<CountMoney cents={tot} money={money} />} tone={tot < 0 ? 'fx-neg' : 'fx-pos'} />; })()}
      <div className="pco-wlist">
        {rows.length === 0 && <p className="fx-muted">{t('pco.noAccounts')}</p>}
        {rows.map(({ a, bal }, i) => <WidgetRow key={a.id} i={i} to="/contas" title={a.name} sub={t('pco.accType_' + a.type)} value={<CountMoney cents={bal} money={money} />} tone={a.type === 'debt' || bal < 0 ? 'fx-neg' : 'fx-pos'} pic={<span className={'wr-ic t-' + a.type}><Ic d={ACC_IC[a.type] ?? WALLET} size={22} /></span>} />)}
      </div>
    </section>
  );
}

export function LimitsWidget({ money, y, m }: { money: (c: number) => string; y: number; m: number }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<{ b: Budget; c?: Category; spent: number }>>([]);
  useEffect(() => {
    (async () => {
      const [bs, cs, txs] = [live(await db.budgets.toArray()), live(await db.categories.toArray()), live(await db.transactions.toArray())];
      const pref = `${y}-${String(m + 1).padStart(2, '0')}`;
      setRows(bs.filter((b) => b.year === y && b.month === m + 1).map((b) => ({
        b, c: cs.find((c) => c.id === b.categoryId),
        spent: txs.filter((x) => x.type === 'expense' && x.categoryId === b.categoryId && x.date.startsWith(pref)).reduce((a, x) => a + x.amountCents, 0),
      })).sort((p, q) => q.spent / q.b.limitCents - p.spent / p.b.limitCents));
    })().catch(() => {});
  }, [y, m]);
  const tot = rows.reduce((a, x) => a + x.b.limitCents, 0), used = rows.reduce((a, x) => a + x.spent, 0), free = tot - used;
  const toneOf = (r: number) => (r > 1 ? 'over' : r > 0.85 ? 'warn' : '');
  return (
    <section className="mv-card pco-w">
      <Head icon={LIMIT} title={L('Limites do mês')} to="/orcamentos" link={rows.length ? t('blk.seeAll') : L('Novo limite')} />
      {rows.length === 0 ? <WidgetEmpty pic={<Ic d={LIMIT} size={28} />} text={L('Sem limites este mês')} to="/orcamentos" label={L('Novo limite')} />
        : <WidgetTop label={free >= 0 ? L('Ainda podes gastar') : L('Passaste os limites em')} value={<CountMoney cents={Math.abs(free)} money={money} />} tone={free < 0 ? 'fx-neg' : 'fx-pos'} ratio={tot > 0 ? used / tot : 0} barTone={toneOf(tot > 0 ? used / tot : 0)} />}
      <div className="pco-wlist">
        {rows.map(({ b, c, spent }, i) => {
          const r = b.limitCents > 0 ? spent / b.limitCents : 0, left = b.limitCents - spent, tn = toneOf(r);
          return <WidgetRow key={b.id} i={i} to="/orcamentos" title={c ? catLabel(t, c) : '—'} sub={`${money(spent)} ${L('de')} ${money(b.limitCents)}`} value={<CountMoney cents={Math.abs(left)} money={money} />} tone={left < 0 ? 'fx-neg' : tn === 'warn' ? 'lm-warn' : 'fx-pos'}
            pic={<GoalRing r={Math.min(1, r)} size={58} tone={tn}><CatIcon cat={c ?? {}} size={34} /></GoalRing>} />;
        })}
      </div>
    </section>
  );
}

export function AssistantWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const go = (text: string) => navigate('/assistente?q=' + encodeURIComponent(text));
  const ex = [t('assistant.ex1'), t('assistant.ex2'), t('assistant.ex3')];
  return (
    <section className="mv-card pco-w pco-ai">
      <Head icon={SPARK} title={t('assistant.title')} to="/assistente" link={L('Abrir')} />
      <p className="fx-muted pco-ai-sub">{L('Pergunta qualquer coisa sobre o teu dinheiro.')}</p>
      <div className="pco-ai-ex">{ex.map((e) => <button key={e} type="button" onClick={() => go(e)}>{e}</button>)}</div>
      <form className="pco-ai-in" onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(q.trim()); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('assistant.placeholder')} />
        <button type="submit" aria-label={t('assistant.send')} disabled={!q.trim()}><Ic d={SEND} size={16} /></button>
      </form>
    </section>
  );
}

type PlanRow = { a: Account; p: PlanInfo };
/** Contas de poupança e de dívida, com o progresso de cada uma. */
export function usePlans(): PlanRow[] | null {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  useEffect(() => {
    (async () => {
      const accs = live(await db.accounts.toArray()), txs = live(await db.transactions.toArray()), goals = live(await db.goals.toArray());
      const trs = live(await db.transfers.toArray()) as Transfer[], n = new Date();
      const sal = live(await db.salaries.toArray()).filter((x) => x.year * 100 + x.month <= n.getFullYear() * 100 + n.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
      setRows(accs.filter((a) => a.type !== 'spending').map((a) => ({ a, p: planInfo(a, accountBalanceCents(a, txs, accs, sal, trs), trs, goals.find((g) => g.id === splitDesc(a.description).plan?.goalId), n) }))
        .sort((x, y) => Number(x.p.total === 0) - Number(y.p.total === 0)));
    })().catch(() => {});
  }, []);
  return rows;
}

const PLAN_IC = 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM8 13l3 3 5-6';
/** Todas as poupanças e dívidas: barra de progresso e data em que devem terminar. */
export function PlansWidget({ rows, money }: { rows: PlanRow[]; money: (c: number) => string }) {
  const { t } = useTranslation();
  return (
    <section className="mv-card pco-w">
      <Head icon={PLAN_IC} title={L('Poupanças e dívidas')} to="/contas" link={t('blk.seeAll')} />
      <div className="pco-wlist">
        {rows.length === 0 && <p className="fx-muted">{L('Cria uma conta de poupança ou de dívida para a acompanhares aqui.')}</p>}
        {rows.map(({ a, p }, i) => <PlanLine key={a.id} i={i} a={a} p={p} money={money} lang={loadSettings().language} />)}
      </div>
    </section>
  );
}
/** Uma só poupança ou dívida. */
export function PlanWidget({ row, money }: { row: PlanRow | undefined; money: (c: number) => string }) {
  return (
    <section className="mv-card pco-w">
      <Head icon={PLAN_IC} title={row?.a.name ?? L('Conta')} to="/contas" link={L('Abrir')} />
      {row ? <PlanOne a={row.a} p={row.p} money={money} lang={loadSettings().language} /> : <p className="fx-muted">{L('Esta conta já não existe.')}</p>}
    </section>
  );
}
