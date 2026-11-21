// Dashboard do admin (ao estilo shadcn-admin): cartões com mini-gráficos e painéis maiores.
// Só dados agregados: contagens, percentagens e distribuições. Nada de valores ou dados de pessoas.
import { useEffect, useState } from 'react';
import { getAdminSupabase as getSupabase } from '../auth/supabase';
import { L } from '../i18n/phrases';
import { PRICES } from '../core/plan';

type Stats = { users_total: number; users_7d: number; users_30d: number; active_7d: number; active_30d: number; unconfirmed: number; with_data: number;
  tx_total: number; tx_30d: number; accounts_total: number; goals_total: number; providers: Record<string, number>; languages: Record<string, number>; signups_by_day: Array<{ day: string; n: number }> };
type Act = { dau: number; wau: number; mau: number; wau_prev: number; mau_prev: number; daily: Array<{ day: string; n: number }>; ret_d1: number | null; ret_d7: number | null; ret_d30: number | null; churn: number | null };
type Pres = { now: number; today: number; week: number; platforms: Record<string, number>; versions: Record<string, number> };
const COLS = ['#2dd4bf', '#8b7cf6', '#f5b85a', '#60a5fa', '#f472b6', '#4ade80', '#f87171'];
const nf = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n));
const growth = (n: number, p: number) => (p > 0 ? Math.round(((n - p) / p) * 100) : null);

export function Delta({ v }: { v: number | null }) {
  if (v === null) return null;
  return <span className={'dsh-delta ' + (v >= 0 ? 'up' : 'down')}>{v >= 0 ? '+' : ''}{v}%</span>;
}
export function MiniBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data);
  return <div className="dsh-mini">{data.map((v, i) => <i key={i} style={{ height: `${Math.max(6, (v / max) * 100)}%`, background: color, opacity: 0.35 + 0.65 * (v / max) }} />)}</div>;
}
export function Spark({ data, color, h = 70, fill = false }: { data: number[]; color: string; h?: number; fill?: boolean }) {
  if (data.length < 2) return <div className="dsh-empty" style={{ height: h }}>{L('Ainda sem dados')}</div>;
  const max = Math.max(1, ...data), w = 100;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 4 - (v / max) * (h - 10)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="dsh-spark" style={{ height: h }}>
      {fill && <polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity="0.15" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
export function Ring({ pct, color, label }: { pct: number | null; color: string; label: string }) {
  const p = Math.max(0, Math.min(100, pct ?? 0)), r = 34, c = 2 * Math.PI * r;
  return (
    <div className="dsh-ring">
      <svg viewBox="0 0 84 84"><circle cx="42" cy="42" r={r} fill="none" stroke="var(--track)" strokeWidth="9" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 42 42)" /></svg>
      <span><b>{pct === null ? '—' : `${pct}%`}</b><small>{label}</small></span>
    </div>
  );
}
export function Donut({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return <div className="dsh-empty">{L('Ainda sem dados')}</div>;
  let acc = 0;
  const grad = entries.map(([, n], i) => { const a = acc; acc += (n / total) * 360; return `${COLS[i % COLS.length]} ${a}deg ${acc}deg`; }).join(', ');
  return (
    <div className="dsh-donut-wrap">
      <div className="dsh-donut" style={{ background: `conic-gradient(${grad})` }}><span><b>{nf(total)}</b><small>{L('Total')}</small></span></div>
      <div className="dsh-legend">{entries.map(([k, n], i) => <p key={k}><i style={{ background: COLS[i % COLS.length] }} />{k}<b>{Math.round((n / total) * 100)}%</b></p>)}</div>
    </div>
  );
}
export function HBars({ data, suffix = '' }: { data: Record<string, number>; suffix?: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = suffix === '%' ? 100 : Math.max(1, ...entries.map(([, n]) => n));
  if (!entries.length) return <div className="dsh-empty">{L('Ainda sem dados')}</div>;
  return <div className="dsh-hbars">{entries.map(([k, n], i) => <div key={k}><span>{k}</span><i><em style={{ width: `${(n / max) * 100}%`, background: COLS[i % COLS.length] }} /></i><b>{nf(n)}{suffix}</b></div>)}</div>;
}
function Card({ title, sub, children, className = '' }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return <section className={'dsh-card ' + className}><header><h3>{title}</h3>{sub && <small>{sub}</small>}</header>{children}</section>;
}

export function AdminDashboard({ part = 'main' }: { part?: 'main' | 'audience' }) {
  const [s, setS] = useState<Stats | null>(null);
  const [a, setA] = useState<Act | null>(null);
  const [p, setP] = useState<Pres | null>(null);
  const [interest, setInterest] = useState<Array<{ plan: string; period: string; n: number }>>([]);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    // admin_dash: só números agregados, aberto a todos os cargos da equipa
    const loadDash = () => sb.rpc('admin_dash').then(({ data }) => {
      if (!data) return;
      const d = data as Stats & Pres & { interest: Record<string, number> };
      setS(d); setP(d); setInterest(Object.entries(d.interest ?? {}).map(([plan, n]) => ({ plan, period: '', n: Number(n) })));
    }, () => {});
    loadDash();
    sb.rpc('admin_activity').then(({ data }) => data && setA(data as Act), () => {});
    const id = setInterval(loadDash, 30000);
    return () => clearInterval(id);
  }, []);

  const signups = (s?.signups_by_day ?? []).map((d) => d.n);
  const daily = (a?.daily ?? []).map((d) => d.n);
  const last14 = signups.slice(-14);
  const bigBars = (s?.signups_by_day ?? []).slice(-12);
  const bigMax = Math.max(1, ...bigBars.map((d) => d.n));
  const peak = bigBars.reduce((m, d) => (d.n > m ? d.n : m), 0);
  const dataPct = s && s.users_total ? Math.round((s.with_data / s.users_total) * 100) : null;
  const confirmedPct = s && s.users_total ? Math.round(((s.users_total - s.unconfirmed) / s.users_total) * 100) : null;
  const interestTotal = interest.reduce((t, r) => t + Number(r.n), 0);
  const interestBy = Object.fromEntries(['plus', 'family', 'pro'].map((pl) => [pl, interest.filter((r) => r.plan === pl).reduce((t, r) => t + Number(r.n), 0)]).filter(([, n]) => (n as number) > 0));

  return (
    <div className="dsh">
      {part === 'main' && <>
      {/* Linha 1: cartões pequenos com mini-gráficos */}
      <div className="dsh-row6">
        <Card title={L('Utilizadores')}><div className="dsh-kv"><b>{nf(s?.users_total)}</b><Delta v={s ? growth(s.users_7d, Math.max(0, s.users_30d - s.users_7d) / 3) : null} /></div><MiniBars data={last14} color="#2dd4bf" /></Card>
        <Card title={L('Online agora')} ><div className="dsh-kv"><b>{nf(p?.now)}</b><i className="dsh-live" /></div><div className="dsh-sub2"><span>{L('Hoje')} <b>{nf(p?.today)}</b></span><span>7d <b>{nf(p?.week)}</b></span></div></Card>
        <Card title="DAU" ><Spark data={daily.slice(-30)} color="#8b7cf6" h={56} /><div className="dsh-kv"><b>{nf(a?.dau)}</b></div></Card>
        <Card title="MAU" sub="30d"><Spark data={daily} color="#60a5fa" h={56} fill /><div className="dsh-kv"><b>{nf(a?.mau)}</b><Delta v={a ? growth(a.mau, a.mau_prev) : null} /></div></Card>
        <Card title={L('Novos registos')} sub="7d"><div className="dsh-kv big"><b>{nf(s?.users_7d)}</b></div><p className="dsh-note">30d: {nf(s?.users_30d)}</p></Card>
        <Card title={L('Movimentos')} sub="30d"><div className="dsh-kv big"><b>{nf(s?.tx_30d)}</b></div><p className="dsh-note">{L('Total')}: {nf(s?.tx_total)}</p></Card>
      </div>

      {/* Linha 2: gráfico grande + relatório + ativos por dia */}
      <div className="dsh-row2">
        <Card title={L('Registos por dia')} sub={L('Últimos 12 dias com registos')} className="dsh-big">
          <div className="dsh-split">
            <div className="dsh-bars">
              {bigBars.length === 0 && <div className="dsh-empty">{L('Ainda sem dados')}</div>}
              {bigBars.map((d) => (
                <div key={d.day} className={d.n === peak ? 'peak' : ''}><b>{d.n}</b><i style={{ height: `${Math.max(4, (d.n / bigMax) * 100)}%` }} /><small>{d.day.slice(8, 10)}/{d.day.slice(5, 7)}</small></div>
              ))}
            </div>
            <div className="dsh-report">
              <h4>{L('Relatório')}</h4>
              <div className="dsh-rep2">
                <div><span className="dsh-ic up">↑</span><small>WAU</small><b>{a ? <>{nf(a.wau)} <Delta v={growth(a.wau, a.wau_prev)} /></> : '—'}</b></div>
                <div><span className="dsh-ic down">↓</span><small>{L('Churn mensal')}</small><b>{a?.churn === null || a?.churn === undefined ? '—' : `${a.churn}%`}</b></div>
              </div>
              <div className="dsh-rep-foot"><small>{L('Contas com dados')}</small><b>{dataPct === null ? '—' : `${dataPct}%`}</b></div>
            </div>
          </div>
        </Card>
        <Card title={L('Utilizadores ativos')} sub={L('Por dia, últimos 90 dias')} className="dsh-line">
          <div className="dsh-kv"><b>{nf(a?.wau)}</b><small className="dsh-muted">{L('esta semana')}</small></div>
          <Spark data={daily} color="#2dd4bf" h={150} fill />
        </Card>
      </div>

      {/* Linha 3: retenção, plataformas, versões */}
      <div className="dsh-row3">
        <Card title={L('Retenção')} sub={L('Pessoas que voltaram depois de se registarem')}>
          <div className="dsh-rings"><Ring pct={a?.ret_d1 ?? null} color="#2dd4bf" label="D1" /><Ring pct={a?.ret_d7 ?? null} color="#8b7cf6" label="D7" /><Ring pct={a?.ret_d30 ?? null} color="#f5b85a" label="D30" /></div>
        </Card>
        <Card title={L('Plataformas')} sub={L('Últimos 30 dias')}><Donut data={p?.platforms ?? {}} /></Card>
        <Card title={L('Versões em uso')} sub={L('Para decidir a versão mínima')}><HBars data={p?.versions ?? {}} /></Card>
      </div>

      </>}
      {part === 'audience' && <h2 className="dsh-h2">{L('Público')}</h2>}
      {part === 'audience' && <>
      {/* Linha 4: idiomas, login, conta, interesse */}
      <div className="dsh-row4">
        <Card title={L('Idiomas')}><HBars data={s?.languages ?? {}} /></Card>
        <Card title={L('Forma de login')}><Donut data={s?.providers ?? {}} /></Card>
        <Card title={L('Contas')} sub={L('Qualidade das contas')}>
          <div className="dsh-rings two"><Ring pct={confirmedPct} color="#4ade80" label={L('Email confirmado')} /><Ring pct={dataPct} color="#60a5fa" label={L('Com dados')} /></div>
          <div className="dsh-sub2"><span>{L('Contas bancárias')} <b>{nf(s?.accounts_total)}</b></span><span>{L('Metas')} <b>{nf(s?.goals_total)}</b></span></div>
        </Card>
        <Card title={L('Interesse nos planos')} sub={`${interestTotal} ${L('pessoas')}`}><Donut data={interestBy as Record<string, number>} /></Card>
      </div>
      </>}
    </div>
  );
}


/* ---------------- Métricas extra: engajamento, adoção, saúde técnica, suporte, segurança, monetização ---------------- */
type M = { users: number; mau: number; signups_today: number; expenses_total: number; expenses_30d: number; goals_total: number; pct_with_goal: number | null;
  avg_session_min: number | null; days_per_user_30: number | null; pct_reports: number | null; adoption: Record<string, number>; pages: Record<string, number>;
  db_size: number; rows: Record<string, number>; errors_7d: number; errors_by_version: Record<string, number>; errors_top: Record<string, number>;
  tickets_open: number; tickets_done_30d: number; tickets_by_kind: Record<string, number>; suspended: number; deleted_30d: number; unconfirmed: number; max_signups_hour_24h: number;
  subs: Record<string, number>; subs_canceled_30d: number };
const PAGE_NAME: Record<string, string> = { '/': 'Resumo', '/transacoes': 'Transações', '/contas': 'Contas', '/calendario': 'Calendário', '/orcamentos': 'Limites', '/metas': 'Metas', '/salarios': 'Salários', '/categorias': 'Categorias', '/assistente': 'Assistente IA', '/definicoes': 'Definições', '/grupos': 'Grupos', '/plus': 'Planos', '/visao-mensal': 'Resumo do mês', '/resumo-ano': 'Resumo do ano', '/dividir': 'Dividir contas', '/familia': 'Família' };
const FEAT_NAME: Record<string, string> = { goals: 'Metas', budgets: 'Limites', salaries: 'Salários', recurring: 'Recorrentes', groups: 'Grupos', custom_categories: 'Categorias personalizadas', multi_accounts: 'Várias contas', exports: 'Exportar / backup' };
const SIC: Record<string, string> = {
  list: 'M9 6h11M9 12h11M9 18h11M5 6h.01M5 12h.01M5 18h.01', target: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', chart: 'M4 19V9M10 19V5M16 19v-7M22 19H2', plus: 'M12 5v14M5 12h14',
  db: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5', key: 'M15 7a4 4 0 1 1-3.9 5H8v3H5v-3H3v-3h8.1A4 4 0 0 1 15 7z',
  disk: 'M4 4h16v16H4zM8 4v6h8V4', bug: 'M8 9h8v8a4 4 0 0 1-8 0zM12 9V5M4 13h4M16 13h4M5 7l3 2M19 7l-3 2', bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8',
};
export function Stat({ label, value, hint, ic = 'chart' }: { label: string; value: React.ReactNode; hint?: string; ic?: string }) {
  return (
    <div className="dsh-stat">
      <div className="dsh-stat-h"><span className="pco-mic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={SIC[ic] ?? SIC.chart} /></svg></span><small>{label}</small></div>
      <b>{value}</b>{hint ? <em>{hint}</em> : <em>&nbsp;</em>}
    </div>
  );
}
export function AdminMoreMetrics({ section }: { section: 'engagement' | 'health' | 'safety' | 'money' }) {
  const [m, setM] = useState<M | null>(null);
  const [err, setErr] = useState(false);
  const [ping, setPing] = useState<{ db: number | null; auth: boolean | null }>({ db: null, auth: null });
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.rpc('admin_metrics').then(({ data, error }) => { if (error) setErr(true); else setM(data as M); }, () => setErr(true));
    // tempo de resposta e estado dos serviços, medidos agora a partir deste aparelho
    const t0 = performance.now();
    sb.rpc('admin_ping').then(({ error }) => setPing((x) => ({ ...x, db: error ? -1 : Math.round(performance.now() - t0) })), () => setPing((x) => ({ ...x, db: -1 })));
    sb.auth.getSession().then(({ error }) => setPing((x) => ({ ...x, auth: !error })), () => setPing((x) => ({ ...x, auth: false })));
  }, []);
  if (err) return <p className="fx-muted fx-small">{L('Corre o ficheiro supabase/admin_metrics.sql no Supabase para ver mais métricas.')}</p>;
  if (!m) return null;
  const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);
  const ofUsers = (n: number) => (m.users ? Math.round((n / m.users) * 100) : 0);
  const adoption = Object.fromEntries(Object.entries(m.adoption).map(([k, n]) => [L(FEAT_NAME[k] ?? k), ofUsers(n)]));
  const pages = Object.fromEntries(Object.entries(m.pages).map(([k, n]) => [L(PAGE_NAME[k] ?? k), n]));
  // monetização (estimativa com os preços mensais do plano)
  const paid = Object.values(m.subs).reduce((a, b) => a + b, 0);
  const mrr = Object.entries(m.subs).reduce((a, [plan, n]) => a + (PRICES[plan as 'plus' | 'pro']?.month ?? PRICES.plus.month) * n, 0) / 100;
  const churnSubs = paid + m.subs_canceled_30d > 0 ? Math.round((m.subs_canceled_30d / (paid + m.subs_canceled_30d)) * 100) : null;
  const arpu = paid ? mrr / paid : 0;
  const ltv = churnSubs && churnSubs > 0 ? arpu / (churnSubs / 100) : null;
  const eur = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB';
  return (
    <div className="dsh">
      {section === 'engagement' && <>
      <div className="dsh-stats">
        <Stat ic="list" label={L('Despesas registadas')} value={nf(m.expenses_total)} hint={`+${nf(m.expenses_30d)} ${L('nos últimos 30 dias')}`} />
        <Stat ic="target" label={L('Metas criadas')} value={nf(m.goals_total)} hint={`${pct(m.pct_with_goal)} ${L('das contas têm metas')}`} />
        <Stat ic="user" label={L('Despesas por pessoa')} value={m.mau ? (m.expenses_30d / m.mau).toFixed(1) : '—'} hint={L('média em 30 dias')} />
        <Stat ic="clock" label={L('Tempo na app')} value={m.avg_session_min === null ? '—' : `${m.avg_session_min} min`} hint={L('por pessoa, por dia')} />
        <Stat ic="cal" label={L('Dias de uso')} value={m.days_per_user_30 === null ? '—' : m.days_per_user_30} hint={L('por pessoa, em 30 dias')} />
        <Stat ic="chart" label={L('Usam relatórios')} value={pct(m.pct_reports)} hint={L('de quem esteve ativo')} />
        <Stat ic="plus" label={L('Registos hoje')} value={nf(m.signups_today)} hint={L('contas novas')} />
        <Stat ic="user" label={L('Ativos (30 dias)')} value={nf(m.mau)} hint={L('pessoas diferentes')} />
      </div>

      <div className="dsh-row2">
        <section className="dsh-card"><header><h3>{L('Adoção de funcionalidades')}</h3><small>{L('% das contas que usam cada funcionalidade')}</small></header><HBars data={adoption} suffix="%" /></section>
        <section className="dsh-card"><header><h3>{L('Ecrãs mais usados')}</h3><small>{L('Minutos nos últimos 30 dias')}</small></header><HBars data={pages} /></section>
      </div>

      </>}
      {section === 'health' && <>
      <div className="dsh-stats">
        <Stat ic="db" label={L('Base de dados')} value={<span className={ping.db !== null && ping.db < 0 ? 'dsh-bad' : 'dsh-ok'}>● {ping.db !== null && ping.db < 0 ? L('Offline') : L('Online')}</span>} hint={ping.db === null || ping.db < 0 ? undefined : `${ping.db} ms`} />
        <Stat ic="key" label={L('Autenticação')} value={ping.auth === null ? '…' : <span className={ping.auth ? 'dsh-ok' : 'dsh-bad'}>● {ping.auth ? L('Online') : L('Offline')}</span>} />
        <Stat ic="disk" label={L('Tamanho')} value={mb(m.db_size)} />
        <Stat ic="bug" label={L('Erros')} value={nf(m.errors_7d)} hint="7d" />
      </div>
      <div className="dsh-row2">
        <section className="dsh-card"><header><h3>{L('Erros por versão')}</h3><small>{L('Últimos 7 dias')}</small></header><HBars data={m.errors_by_version} /></section>
        <section className="dsh-card"><header><h3>{L('Erros mais frequentes')}</h3><small>{L('Últimos 7 dias')}</small></header><HBars data={m.errors_top} /></section>
      </div>

      </>}
      {section !== 'engagement' && section !== 'health' && <div className="dsh-row2">
        {section === 'safety' && <section className="dsh-card"><header><h3>{L('Suporte')}</h3><small>{L('Tickets vindos da app')}</small></header>
          <div className="dsh-sub2"><span>{L('Abertos')} <b>{nf(m.tickets_open)}</b></span><span>{L('Resolvidos (30d)')} <b>{nf(m.tickets_done_30d)}</b></span></div>
          <Donut data={m.tickets_by_kind} />
          <p className="dsh-note">{L('Avaliações nas lojas e desinstalações: só ficam disponíveis quando a app estiver na Play Store / App Store.')}</p>
        </section>}
        {section === 'safety' && <section className="dsh-card"><header><h3>{L('Segurança')}</h3><small>{L('Só números agregados')}</small></header>
          <div className="dsh-kvs">
            <p><span>{L('Contas suspensas')}</span><b>{nf(m.suspended)}</b></p>
            <p><span>{L('Contas eliminadas (30d)')}</span><b>{nf(m.deleted_30d)}</b></p>
            <p><span>{L('Emails por confirmar')}</span><b>{nf(m.unconfirmed)}</b></p>
            <p><span>{L('Máx. registos numa hora (24h)')}</span><b className={m.max_signups_hour_24h > 20 ? 'fx-neg' : ''}>{nf(m.max_signups_hour_24h)}</b></p>
          </div>
          {m.max_signups_hour_24h > 20 && <p className="fx-error">{L('Pico anormal de registos: verifica se não são contas falsas.')}</p>}
        </section>}
        {section === 'money' && <section className="dsh-card"><header><h3>{L('Monetização')}</h3><small>{L('Estimativa com os preços mensais')}</small></header>
          <div className="dsh-kvs">
            <p><span>{L('Subscritores')}</span><b>{nf(paid)}</b></p>
            <p><span>{L('Conversão grátis → pago')}</span><b>{m.users ? `${((paid / m.users) * 100).toFixed(1)}%` : '—'}</b></p>
            <p><span>MRR</span><b>{eur(mrr)}</b></p>
            <p><span>ARR</span><b>{eur(mrr * 12)}</b></p>
            <p><span>{L('Churn de subscritores (30d)')}</span><b>{churnSubs === null ? '—' : `${churnSubs}%`}</b></p>
            <p><span>{L('LTV estimado')}</span><b>{ltv === null ? '—' : eur(ltv)}</b></p>
          </div>
        </section>}
      </div>}
    </div>
  );
}
