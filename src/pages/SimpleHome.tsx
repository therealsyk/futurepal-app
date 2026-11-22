// Início simplificado — só o essencial, para qualquer pessoa.
//  1. Quanto ainda tenho este mês  2. Adicionar gasto / dinheiro recebido  3. A minha poupança  4. Últimos movimentos
import type { CSSProperties } from 'react';
import { GoalRing } from '../ui/GoalRing';
import { LimitsWidget } from './PcWidgets';
import { isFresh } from '../core/onboarding';
import { CountMoney } from '../ui/CountMoney';
import { goalEtaMonths } from '../core/goalEta';
import { fill } from '../ui/AccountPlan';
import { WidgetEmpty, WidgetRow } from '../ui/WidgetRow';
import { GroupPic } from './Groups';
import { NotificationBell } from '../ui/AccountBar';
import { goalValueCents, splitDesc } from '../core/debtPlan';
import { cmpShort, cmpText, refText } from '../core/compare';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Category, Transaction, Transfer, Salary, Group, Goal } from '../db/database';
import { accountBalanceCents } from '../core/accounts';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { useAuth } from '../auth/AuthContext';
import { UserAvatar } from '../ui/UserAvatar';
import { Ic, ICON, CatIcon, catLabel } from '../ui/fx';
import { L } from '../i18n/phrases';
import { PeriodFilter, initialPeriod, periodRange, previousRange, type Period } from '../ui/PeriodFilter';

const GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z';

// só as metas criadas à parte: as das contas acompanham-se na própria conta
async function ownGoals(): Promise<Goal[]> {
  const mine = new Set((await db.accounts.toArray()).filter((a) => a.deletedAt === null).map((a) => splitDesc(a.description).plan?.goalId).filter(Boolean));
  return (await db.goals.toArray()).filter((g) => g.deletedAt === null && !mine.has(g.id));
}
const ACC_IC: Record<string, string> = { spending: ICON.wallet, savings: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2z', debt: 'M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5' };
export type HomePart = 'hero' | 'latest' | 'groups' | 'goals';
/** embed: mostra só um bloco, com o período escolhido fora (Painel do PC). */
export function SimpleHome({ embed }: { embed?: { mode: 'month' | 'year'; y: number; m: number; part: HomePart; range?: { from: string; to: string }; seeAll?: string } } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const [data, setData] = useState<{ txs: Transaction[]; cats: Category[]; accounts: Account[]; transfers: Transfer[]; salaries: Salary[]; groups: Group[]; goals: Goal[] } | null>(null);

  useEffect(() => {
    (async () => {
      const live = <T extends { deletedAt: string | null }>(a: T[]) => a.filter((x) => x.deletedAt === null);
      setData({
        txs: live(await db.transactions.toArray()), cats: live(await db.categories.toArray()), accounts: live(await db.accounts.toArray()),
        transfers: live(await db.transfers.toArray()), salaries: live(await db.salaries.toArray()),
        groups: live(await db.groups.toArray()), goals: await ownGoals(),
      });
    })().catch(() => {});
  }, []);

  const now = new Date();
  const [per, setPer] = useState<Period>(() => initialPeriod(now));
  const ranged = !embed && per.mode === 'range';
  const mode = embed?.mode ?? (per.mode === 'month' ? 'month' : 'year');
  const cur = embed ? { y: embed.y, m: embed.m } : { y: per.y, m: per.m };
  const prefix = mode === 'year' ? String(cur.y) : `${cur.y}-${String(cur.m + 1).padStart(2, '0')}`;
  const pr = embed ? null : periodRange(per), ppr = embed ? null : previousRange(per);
  const month = (data?.txs ?? []).filter((x) => (pr ? x.date >= pr.from && x.date <= pr.to : x.date.startsWith(prefix)));
  const prevPrefix = mode === 'year' ? String(cur.y - 1) : (() => { const pd = new Date(cur.y, cur.m - 1, 1); return `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`; })();
  const prevSpent = (data?.txs ?? []).filter((x) => x.type === 'expense' && (ppr ? x.date >= ppr.from && x.date <= ppr.to : x.date.startsWith(prevPrefix))).reduce((a, x) => a + x.amountCents, 0);
  const received = month.filter((x) => x.type === 'income').reduce((a, x) => a + x.amountCents, 0);
  const spent = month.filter((x) => x.type === 'expense').reduce((a, x) => a + x.amountCents, 0);
  const left = received - spent;
  const ratio = received > 0 ? Math.min(1, spent / received) : spent > 0 ? 1 : 0;
  const salaryToDate = (data?.salaries ?? []).filter((x) => x.year * 100 + x.month <= now.getFullYear() * 100 + now.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
  // Só contas com dinheiro (as dívidas, ex.: empréstimo da casa, ficam de fora para não assustar)
  const saved = data ? data.accounts.filter((a) => a.type !== 'debt').reduce((sum, a) => sum + accountBalanceCents(a, data.txs, data.accounts, salaryToDate, data.transfers), 0) : 0;
  const accRows = data ? [...data.accounts].sort((a, b) => Number(a.type === 'debt') - Number(b.type === 'debt') || a.order - b.order).map((a) => ({ a, bal: accountBalanceCents(a, data.txs, data.accounts, salaryToDate, data.transfers) })) : [];
  const fresh = isFresh(); // conta nova: só o essencial
  const rng = embed ? embed.range : ranged ? pr ?? undefined : undefined;
  const inRange = (data?.txs ?? []).filter((x) => !rng || (x.date >= rng.from && x.date <= rng.to));
  const latest = [...inRange].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, embed ? 40 : 5); // no Resumo do PC o widget pode ser esticado: mostra o que couber
  const catOf = (id: string) => data?.cats.find((c) => c.id === id);
  const meta = (auth.user?.user_metadata ?? {}) as { name?: string; full_name?: string };
  const name = meta.full_name || meta.name || auth.user?.email?.split('@')[0] || '';

  const heroEl = (<>
      <section className="mv-hero sh-hero" data-tour={embed ? undefined : 'month'}>
        {(() => {
          const pct = received > 0 ? Math.round((spent / received) * 100) : null;
          // cor do quanto já se gastou do rendimento: sem cor até 50% (normal), amarelo até 80%, vermelho a partir daí
          const heat = (p: number) => { const v = Math.max(0, Math.min(100, p)), hue = Math.round(v <= 50 ? 145 - v * 2 : 45 - (v - 50) * 0.9); return { color: `hsl(${hue} 80% 64%)`, background: `hsl(${hue} 80% 55% / ${(0.1 + v * 0.0016).toFixed(2)})` }; }; // verde → amarelo (50%) → vermelho (100%)
          const dlt = prevSpent > 0 && spent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null;
          const nMonths = cur.y === now.getFullYear() ? now.getMonth() + 1 : 12;
          const ref = refText(t, s.language, ranged ? { kind: 'preset', preset: per.preset } : { kind: mode === 'month' ? 'prevMonth' : 'prevYear' });
          const cmp = dlt === null ? null : <small className="sh-cmp hm-l">{dlt === 0 ? cmpText(t, dlt, ref) : <>{L('Gastaste')} <b className={dlt > 10 ? 'fx-neg' : dlt > 0 ? 'lm-warn' : 'fx-pos'}>{cmpShort(t, dlt)}</b>{cmpText(t, dlt, ref).startsWith(cmpShort(t, dlt)) ? cmpText(t, dlt, ref).slice(cmpShort(t, dlt).length) : ' ' + ref}</>}</small>;
          return mode === 'month' ? (
            <>
              <small className="mv-hero-label">{L('Ainda tens para gastar')}</small>
              <div className="sh-valrow"><span className={'sh-big ' + (left < 0 ? 'fx-neg' : 'fx-pos')}>{money(left)}</span></div>{pct !== null && <span className="hm-pill" style={heat(pct)}><b>{pct}%</b> {L('do rendimento do mês já foi gasto')}</span>}
              <div className={"sh-bar" + (left < 0 ? " over" : "")} aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></div>
              {cmp}
            </>
          ) : (
            <>
              <small className="mv-hero-label">{ranged ? L('Recebeste neste período') : L('Recebeste este ano')}</small>
              <div className="sh-valrow"><span className="sh-big fx-pos">{money(received)}</span></div>
              {!ranged && <small className="sh-cmp hm-l">{t('pco.avgMonth', { v: money(Math.round(received / nMonths)) })}</small>}
              <div className={"sh-bar" + (left < 0 ? " over" : "")} aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></div>

            </>
          );
        })()}
      </section>
      {/* ano: só o total e a média por mês; as comparações estão no resumo completo */}
      {mode === 'year' && <div className="yr-two">
        {([['exp', "M12 5v14M5 12l7 7 7-7", ranged ? L('Despesas') : L('Despesas do ano'), spent, 'fx-neg'], ['sav', "M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01", ranged ? L('Poupança') : L('Poupança do ano'), left, left < 0 ? 'fx-neg' : 'fx-pos']] as const).map(([k, d, label, v, tone], i) => (
          <div key={k} className={'mv-card yr-box ' + k} style={{ '--i': i } as CSSProperties}><span className="pco-mic"><Ic d={d} size={18} /></span><small>{label}</small><b className={tone}>{money(v)}</b>{!ranged && <em>{money(Math.round(v / (cur.y === now.getFullYear() ? now.getMonth() + 1 : 12)))}/{L('mês')}</em>}</div>
        ))}
      </div>}

      <Link to={ranged && pr ? `/transacoes?de=${pr.from}&ate=${pr.to}` : mode === 'month' ? '/visao-mensal' : `/resumo-ano?ano=${cur.y}`} className="sh-link">{ranged ? L('Ver movimentos do período') : mode === 'month' ? L('Ver resumo do mês') : L('Ver resumo do ano')} <Ic d={ICON.right} size={14} /></Link>

      {/* 2. As duas ações (só no mês; no ano o foco é o balanço) */}
      {mode === 'month' && !embed && <div className="sh-actions" data-tour="quick">
        <Link to="/transacoes?nova=1" className="sh-btn out"><Ic d="M5 12h14" size={22} />{L('Gastei')}</Link>
        <Link to="/transacoes?nova=1&tipo=income" className="sh-btn in"><Ic d="M12 5v14M5 12h14" size={22} />{L('Recebi')}</Link>
      </div>}
      {fresh && !embed && (data?.goals.length ?? 0) === 0 && <Link to="/metas" className="gl-act hm-goal"><Ic d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" size={18} />{L('Criar meta')}</Link>}

      {/* 3. As contas da pessoa e quanto tem em cada uma */}
      {!embed && accRows.length > 0 && <section className="mv-card sh-accs" data-tour="accounts">
        <div className="mv-card-head"><h2>{L('As tuas contas')}</h2><Link to="/contas" className="mv-link">{L('Ver todas')}</Link></div>
        {accRows.map(({ a, bal }) => (
          <Link key={a.id} to="/contas" className={'sh-accrow t-' + a.type}>
            <span className="sh-accic"><Ic d={ACC_IC[a.type] ?? ICON.wallet} size={19} /></span>
            <span className="sh-tx-main"><b>{a.name}</b><small>{a.type === 'debt' ? L('Dívida') : a.type === 'savings' ? L('Poupança') : L('Gastos')}</small></span>
            <b className={a.type === 'debt' || bal < 0 ? 'fx-neg' : ''}>{money(bal)}</b>
          </Link>
        ))}
        {accRows.filter((r) => r.a.type !== 'debt').length > 1 && <div className="sh-accrow sh-acctotal"><span className="sh-tx-main"><b>{L('Total')}</b></span><b className={saved < 0 ? 'fx-neg' : 'fx-pos'}>{money(saved)}</b></div>}
      </section>}

  </>);
  const latestEl = (<>
      {/* 4. Últimos movimentos, em linguagem simples */}
      <section className="mv-card">
        <div className="mv-card-head">{embed && <span className="pco-mic"><Ic d="M4 7h13l-3-3M20 17H7l3 3" size={18} /></span>}<h2>{t('blk.latest')}{rng && <small className="sh-count">{t('blk.txCount', { count: inRange.length })}</small>}</h2><Link to={embed?.seeAll ?? (rng ? `/transacoes?de=${rng.from}&ate=${rng.to}` : '/transacoes')} className="mv-link">{t('blk.seeAll')}</Link></div>
        <div className="sh-scroll">{latest.length === 0 ? <p className="fx-muted">{t('blk.noTx')}</p> : latest.map((x) => {
          const c = catOf(x.categoryId);
          return (
            <div key={x.id} className="sh-tx">
              <CatIcon cat={c ?? {}} size={36} />
              <span className="sh-tx-main"><b>{x.description || (c ? catLabel(t, c) : '')}</b><small>{new Date(x.date).toLocaleDateString(s.language, { day: 'numeric', month: 'short' })}</small></span>
              <b className={x.type === 'income' ? 'fx-pos' : ''}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</b>
            </div>
          );
        })}</div>
      </section>
  </>);
  const groupsEl = (<>
      {/* 5. Grupos: juntar despesas de uma coisa só (férias, obras...) */}
      <section className="mv-card">
        <div className="mv-card-head">{embed && <span className="pco-mic"><Ic d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" size={18} /></span>}<h2>{L('Os teus grupos')}</h2><Link to="/grupos" className="mv-link">{L('Ver todos')}</Link></div>
        <div className="sh-scroll wr-list">
          {(data?.groups ?? []).length === 0 && <WidgetEmpty pic={<Ic d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" size={28} />} text={L('Junta despesas de uma coisa só e vê quanto custou no total.')} to="/grupos" label={L('Novo grupo')} />}
          {(data?.groups ?? []).slice(0, embed ? 40 : 3).map((g, i) => {
            const gt = (data?.txs ?? []).filter((x) => x.groupId === g.id);
            return <WidgetRow key={g.id} i={i} to={`/grupos/${g.id}`} title={g.name} sub={`${gt.length} ${gt.length === 1 ? L('movimento') : L('movimentos')}`} value={money(gt.reduce((a, x) => a + (x.type === 'expense' ? x.amountCents : -x.amountCents), 0))} pic={<span style={{ '--g': g.color } as CSSProperties}><GroupPic name={g.name} image={g.image} /></span>} />;
          })}
        </div>
      </section>

  </>);
  // quando se chega à meta: pela data limite e pelo ritmo (valor por mês ou o que costuma juntar)
  const goalWhen = (g: Goal, cur: number): string | undefined => {
    const n = data ? goalEtaMonths(g, cur, data, now) : null;
    const eta = n === null ? '' : new Date(now.getFullYear(), now.getMonth() + n, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' });
    if (eta) return fill(L('Chegas lá em {d}'), { d: eta });
    return g.targetDate ? fill(L('Até {d}'), { d: new Date(g.targetDate).toLocaleDateString(s.language, { day: 'numeric', month: 'long', year: 'numeric' }) }) : undefined;
  };
  const goalsEl = (<>
      {/* 6. Metas: só a principal, com a barra */}
      <section className="mv-card">
        <div className="mv-card-head">{embed && <span className="pco-mic"><Ic d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" size={18} /></span>}<h2>{L('Metas')}</h2>{(data?.goals.length ?? 0) > 0 && <Link to="/metas" className="mv-link">{L('Ver todas')}</Link>}</div>
        <div className="sh-scroll wr-list">{(data?.goals ?? []).slice(0, embed ? 20 : 3).map((g, i) => {
          const gc = g.accountIds?.length ? accRows.filter((x) => g.accountIds!.includes(x.a.id)).reduce((x, y) => x + goalValueCents(y.a, y.bal), 0) : g.currentCents; // ligada a contas: o valor vem delas
          const r = g.targetCents > 0 ? Math.max(0, Math.min(1, gc / g.targetCents)) : 0;
          return (
            <WidgetRow key={g.id} i={i} to="/metas" title={g.name} sub={`${money(gc)} ${L('de')} ${money(g.targetCents)}`} value={r >= 1 ? '🎉' : <CountMoney cents={Math.max(0, g.targetCents - gc)} money={money} />} when={r >= 1 ? undefined : goalWhen(g, gc)} pic={<GoalRing r={r} size={58} />} />
          );
        })}
        {(data?.goals.length ?? 0) === 0 && <WidgetEmpty pic={<Ic d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" size={28} />} text={L('Define um objetivo (ex.: 1000 € para férias) e acompanha quanto falta.')} to="/metas" label={L('Criar meta')} />}</div>
      </section>
  </>);
  if (embed) return <div className="mv sh sh-embed">{{ hero: heroEl, latest: latestEl, groups: groupsEl, goals: goalsEl }[embed.part]}</div>;

  return (
    <div className="fx-page mv sh">
      <header className="mv-head">
        <div className="mv-hello">
          <UserAvatar user={auth.user} name={name || '?'} className="ab-initials mv-avatar" />
          <div className="mv-hello-txt">{name && <small>{L('Olá,')}</small>}<h1 style={{ fontSize: Math.max(13, Math.min(20, Math.floor(100 / ((name.split(' ')[0].length + 1) * 0.58)))) }}>{name ? name.split(' ')[0] + '!' : L('Olá!')}</h1></div>
        </div>
        <NotificationBell />
        <button type="button" className="mv-sq mv-menu" data-tour="menu" onClick={() => window.dispatchEvent(new Event('wallet:open-more'))} aria-label={L('Mais funções')}><Ic d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" size={19} /><span>{L('Menu')}</span></button>
        <button type="button" className="mv-sq" data-tour="settings" onClick={() => navigate('/definicoes')} aria-label={t('nav.settings')}><Ic d={GEAR} size={20} /></button>
      </header>

      {/* 1. A pergunta principal, com uma escolha clara: este mês ou o ano todo */}
      <PeriodFilter value={per} onChange={setPer} />
      {heroEl}
      {latestEl}
      {(!fresh || (data?.groups.length ?? 0) > 0) && groupsEl}
      {(!fresh || (data?.goals.length ?? 0) > 0) && goalsEl}
      {!fresh && <LimitsWidget money={money} y={now.getFullYear()} m={now.getMonth()} />}
    </div>
  );
}
