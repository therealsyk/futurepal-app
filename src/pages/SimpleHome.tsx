// Início simplificado — só o essencial, para qualquer pessoa.
//  1. Quanto ainda tenho este mês  2. Adicionar gasto / dinheiro recebido  3. A minha poupança  4. Últimos movimentos
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

const GEAR = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z';

export type HomePart = 'hero' | 'latest' | 'groups' | 'goals';
/** embed: mostra só um bloco, com o período escolhido fora (Painel do PC). */
export function SimpleHome({ embed }: { embed?: { mode: 'month' | 'year'; y: number; m: number; part: HomePart } } = {}) {
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
        groups: live(await db.groups.toArray()), goals: live(await db.goals.toArray()),
      });
    })().catch(() => {});
  }, []);

  const now = new Date();
  const [modeS, setMode] = useState<'month' | 'year'>('month');
  const mode = embed?.mode ?? modeS;
  const [curS, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const cur = embed ? { y: embed.y, m: embed.m } : curS;
  const shift = (d: number) => setCur((c) => (mode === 'year' ? { y: c.y + d, m: c.m } : { y: c.y + Math.floor((c.m + d) / 12), m: ((c.m + d) % 12 + 12) % 12 }));
  const prefix = mode === 'year' ? String(cur.y) : `${cur.y}-${String(cur.m + 1).padStart(2, '0')}`;
  const month = (data?.txs ?? []).filter((x) => x.date.startsWith(prefix));
  const prevPrefix = mode === 'year' ? String(cur.y - 1) : (() => { const pd = new Date(cur.y, cur.m - 1, 1); return `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`; })();
  const prevSpent = (data?.txs ?? []).filter((x) => x.type === 'expense' && x.date.startsWith(prevPrefix)).reduce((a, x) => a + x.amountCents, 0);
  const received = month.filter((x) => x.type === 'income').reduce((a, x) => a + x.amountCents, 0);
  const spent = month.filter((x) => x.type === 'expense').reduce((a, x) => a + x.amountCents, 0);
  const left = received - spent;
  const ratio = received > 0 ? Math.min(1, spent / received) : spent > 0 ? 1 : 0;
  const salaryToDate = (data?.salaries ?? []).filter((x) => x.year * 100 + x.month <= now.getFullYear() * 100 + now.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
  // Só contas com dinheiro (as dívidas, ex.: empréstimo da casa, ficam de fora para não assustar)
  const saved = data ? data.accounts.filter((a) => a.type !== 'debt').reduce((sum, a) => sum + accountBalanceCents(a, data.txs, data.accounts, salaryToDate, data.transfers), 0) : 0;
  const latest = [...(data?.txs ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const catOf = (id: string) => data?.cats.find((c) => c.id === id);
  const meta = (auth.user?.user_metadata ?? {}) as { name?: string; full_name?: string };
  const name = meta.full_name || meta.name || auth.user?.email?.split('@')[0] || '';
  const periodLabel = mode === 'year' ? String(cur.y) : new Date(cur.y, cur.m, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' });

  const heroEl = (<>
      <section className="mv-hero sh-hero">
        {!embed && <div className="mv-hero-top">
          <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={mode === 'month' ? 'Mês anterior' : 'Ano anterior'}><Ic d={ICON.left} size={18} /></button>
          <span className="mv-month">{periodLabel}</span>
          <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={mode === 'month' ? 'Mês seguinte' : 'Ano seguinte'}><Ic d={ICON.right} size={18} /></button>
        </div>}
        {(() => {
          const pct = received > 0 ? Math.round((spent / received) * 100) : null;
          // cor do quanto já se gastou do rendimento: sem cor até 50% (normal), amarelo até 80%, vermelho a partir daí
          const tone = (p: number) => (p >= 80 ? 'bad' : p >= 50 ? 'warn' : 'neutral');
          const dlt = prevSpent > 0 && spent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null;
          const cmp = dlt === null ? null : <small className={'sh-cmp ' + (dlt > 0 ? 'fx-neg' : 'fx-pos')}>{dlt > 0 ? '↑' : '↓'} {Math.abs(dlt)}% vs {mode === 'month' ? 'mês anterior' : 'ano anterior'}</small>;
          return mode === 'month' ? (
            <>
              <small className="mv-hero-label">Ainda tens para gastar</small>
              <div className="sh-valrow"><span className={'sh-big ' + (left < 0 ? 'fx-neg' : 'fx-pos')}>{money(left)}</span>{pct !== null && <span className={'fx-chip ' + tone(pct)} title="do rendimento já gasto">{pct}%</span>}</div>
              <div className="sh-bar" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></div>
              {cmp}
            </>
          ) : (
            <>
              <small className="mv-hero-label">Recebeste este ano</small>
              <div className="sh-valrow"><span className="sh-big fx-pos">{money(received)}</span></div>
              <div className="sh-bar" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></div>
              <div className="sh-kpis">
                <div className="sh-kpi"><small>Gastos</small><div className="sh-valrow"><b className="fx-neg">{money(spent)}</b>{pct !== null && <span className={'fx-chip ' + tone(pct)}>{pct}%</span>}</div>{cmp}</div>
                <div className="sh-kpi"><small>Poupança</small><div className="sh-valrow"><b className={left < 0 ? 'fx-neg' : 'fx-pos'}>{money(left)}</b>{received > 0 && <span className={'fx-chip ' + (left < 0 ? 'bad' : 'good')}>{Math.round((left / received) * 100)}%</span>}</div></div>
              </div>
            </>
          );
        })()}
      </section>

      <Link to={mode === 'month' ? '/visao-mensal' : `/resumo-ano?ano=${cur.y}`} className="sh-link">{mode === 'month' ? 'Ver resumo do mês' : 'Ver resumo do ano'} <Ic d={ICON.right} size={14} /></Link>

      {/* 2. As duas ações (só no mês; no ano o foco é o balanço) */}
      {mode === 'month' && !embed && <div className="sh-actions">
        <Link to="/transacoes?nova=1" className="sh-btn out"><Ic d="M5 12h14" size={22} />Gastei</Link>
        <Link to="/transacoes?nova=1&tipo=income" className="sh-btn in"><Ic d="M12 5v14M5 12h14" size={22} />Recebi</Link>
      </div>}

      {/* 3. Poupança: um número, sem gráficos */}
      {mode === 'year' && <Link to="/contas" className="mv-card sh-save">
        <span className="sh-save-ic"><Ic d="M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01" size={22} /></span>
        <span className="sh-save-txt"><small>O teu dinheiro guardado</small><b>{money(saved)}</b></span>
        <Ic d={ICON.right} size={18} />
      </Link>}

  </>);
  const latestEl = (<>
      {/* 4. Últimos movimentos, em linguagem simples */}
      <section className="mv-card">
        <div className="mv-card-head"><h2>{t('blk.latest')}</h2><Link to="/transacoes" className="mv-link">{t('blk.seeAll')}</Link></div>
        {latest.length === 0 ? <p className="fx-muted">{t('blk.noTx')}</p> : latest.map((x) => {
          const c = catOf(x.categoryId);
          return (
            <div key={x.id} className="sh-tx">
              <CatIcon cat={c ?? {}} size={36} />
              <span className="sh-tx-main"><b>{x.description || (c ? catLabel(t, c) : '')}</b><small>{new Date(x.date).toLocaleDateString(s.language, { day: 'numeric', month: 'short' })}</small></span>
              <b className={x.type === 'income' ? 'fx-pos' : ''}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</b>
            </div>
          );
        })}
      </section>
  </>);
  const groupsEl = (<>
      {/* 5. Grupos: juntar despesas de uma coisa só (férias, obras...) */}
      <section className="mv-card">
        <div className="mv-card-head"><h2>Os teus grupos</h2><Link to="/grupos" className="mv-link">Ver todos</Link></div>
        <div className="sh-groups-row">
          {(data?.groups ?? []).map((g) => {
            const gt = (data?.txs ?? []).filter((x) => x.groupId === g.id);
            return <Link key={g.id} to={`/grupos/${g.id}`} className="sh-group" style={{ ['--g' as string]: g.color }}><b>{g.name}</b><span>{money(gt.reduce((a, x) => a + (x.type === 'expense' ? x.amountCents : -x.amountCents), 0))}</span><small>{gt.length} movimentos</small></Link>;
          })}
          <Link to="/grupos" className="sh-group new"><Ic d={ICON.plus} size={20} /><b>Novo grupo</b></Link>
        </div>
      </section>

  </>);
  const goalsEl = (<>
      {/* 6. Metas: só a principal, com a barra */}
      <section className="mv-card">
        <div className="mv-card-head"><h2>Metas</h2><Link to="/metas" className="mv-link">{(data?.goals.length ?? 0) > 0 ? 'Ver todas' : 'Criar meta'}</Link></div>
        {(data?.goals ?? []).slice(0, 1).map((g) => {
          const r = g.targetCents > 0 ? Math.min(1, g.currentCents / g.targetCents) : 0;
          return (
            <div key={g.id} className="sh-goal">
              <div className="sh-row"><b>{g.name}</b><b>{Math.round(r * 100)}%</b></div>
              <div className="sh-bar"><i style={{ width: `${r * 100}%` }} /></div>
              <div className="sh-row"><small>{money(g.currentCents)} guardados</small><small>faltam {money(Math.max(0, g.targetCents - g.currentCents))}</small></div>
            </div>
          );
        })}
        {(data?.goals.length ?? 0) === 0 && <p className="fx-muted" style={{ margin: 0 }}>Define um objetivo (ex.: 1000 € para férias) e acompanha quanto falta.</p>}
      </section>
  </>);
  if (embed) return <div className="mv sh sh-embed">{{ hero: heroEl, latest: latestEl, groups: groupsEl, goals: goalsEl }[embed.part]}</div>;

  return (
    <div className="fx-page mv sh">
      <header className="mv-head">
        <div className="mv-hello">
          <UserAvatar user={auth.user} name={name || '?'} className="ab-initials mv-avatar" />
          <div className="mv-hello-txt">{name && <small>Olá,</small>}<h1>{name ? name.split(' ')[0] + '!' : 'Olá!'}</h1></div>
        </div>
        <button type="button" className="mv-sq" onClick={() => window.dispatchEvent(new Event('wallet:open-more'))} aria-label="Mais funções"><Ic d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" size={19} /></button>
        <button type="button" className="mv-sq" onClick={() => navigate('/definicoes')} aria-label={t('nav.settings')}><Ic d={GEAR} size={20} /></button>
      </header>

      {/* 1. A pergunta principal, com uma escolha clara: este mês ou o ano todo */}
      <div className="sh-seg" role="tablist" aria-label="Período">
        <button type="button" role="tab" aria-selected={mode === 'month'} className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Este mês</button>
        <button type="button" role="tab" aria-selected={mode === 'year'} className={mode === 'year' ? 'on' : ''} onClick={() => setMode('year')}>O ano todo</button>
      </div>
      {heroEl}
      {latestEl}
      {groupsEl}
      {goalsEl}
    </div>
  );
}
