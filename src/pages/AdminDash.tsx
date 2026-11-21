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

function Delta({ v }: { v: number | null }) {
  if (v === null) return null;
  return <span className={'dsh-delta ' + (v >= 0 ? 'up' : 'down')}>{v >= 0 ? '+' : ''}{v}%</span>;
}
function MiniBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data);
  return <div className="dsh-mini">{data.map((v, i) => <i key={i} style={{ height: `${Math.max(6, (v / max) * 100)}%`, background: color, opacity: 0.35 + 0.65 * (v / max) }} />)}</div>;
}
function Spark({ data, color, h = 70, fill = false }: { data: number[]; color: string; h?: number; fill?: boolean }) {
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
function Ring({ pct, color, label }: { pct: number | null; color: string; label: string }) {
  const p = Math.max(0, Math.min(100, pct ?? 0)), r = 34, c = 2 * Math.PI * r;
  return (
    <div className="dsh-ring">
      <svg viewBox="0 0 84 84"><circle cx="42" cy="42" r={r} fill="none" stroke="var(--track)" strokeWidth="9" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 42 42)" /></svg>
      <span><b>{pct === null ? '—' : `${pct}%`}</b><small>{label}</small></span>
    </div>
  );
}
function Donut({ data }: { data: Record<string, number> }) {
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
function HBars({ data, suffix = '' }: { data: Record<string, number>; suffix?: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = suffix === '%' ? 100 : Math.max(1, ...entries.map(([, n]) => n));
  if (!entries.length) return <div className="dsh-empty">{L('Ainda sem dados')}</div>;
  return <div className="dsh-hbars">{entries.map(([k, n], i) => <div key={k}><span>{k}</span><i><em style={{ width: `${(n / max) * 100}%`, background: COLS[i % COLS.length] }} /></i><b>{nf(n)}{suffix}</b></div>)}</div>;
}
function Card({ title, sub, children, className = '' }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return <section className={'dsh-card ' + className}><header><h3>{title}</h3>{sub && <small>{sub}</small>}</header>{children}</section>;
}

export function AdminDashboard() {
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
      {/* Linha 1: cartões pequenos com mini-gráficos */}
      <div className="dsh-row6">
        <Card title={L('Utilizadores')} sub={L('Total de contas')}><div className="dsh-kv"><b>{nf(s?.users_total)}</b><Delta v={s ? growth(s.users_7d, Math.max(0, s.users_30d - s.users_7d) / 3) : null} /></div><MiniBars data={last14} color="#2dd4bf" /></Card>
        <Card title={L('Online agora')} sub={L('Últimos 3 minutos')}><div className="dsh-kv"><b>{nf(p?.now)}</b><i className="dsh-live" /></div><div className="dsh-sub2"><span>{L('Hoje')} <b>{nf(p?.today)}</b></span><span>7d <b>{nf(p?.week)}</b></span></div></Card>
        <Card title="DAU" sub={L('Ativos hoje')}><Spark data={daily.slice(-30)} color="#8b7cf6" h={56} /><div className="dsh-kv"><b>{nf(a?.dau)}</b></div></Card>
        <Card title="MAU" sub={L('Ativos em 30 dias')}><Spark data={daily} color="#60a5fa" h={56} fill /><div className="dsh-kv"><b>{nf(a?.mau)}</b><Delta v={a ? growth(a.mau, a.mau_prev) : null} /></div></Card>
        <Card title={L('Novos registos')} sub={L('Últimos 7 dias')}><div className="dsh-kv big"><b>{nf(s?.users_7d)}</b></div><p className="dsh-note">{nf(s?.users_30d)} {L('em 30 dias')}</p></Card>
        <Card title={L('Movimentos')} sub={L('Últimos 30 dias (só contagem)')}><div className="dsh-kv big"><b>{nf(s?.tx_30d)}</b></div><p className="dsh-note">{nf(s?.tx_total)} {L('no total')}</p></Card>
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
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return <div className="dsh-stat"><small>{label}</small><b>{value}</b>{hint && <em>{hint}</em>}</div>;
}
export function AdminMoreMetrics() {
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
      <h2 className="dsh-h2">{L('Engajamento e utilização')}</h2>
      <div className="dsh-stats">
        <Stat label={L('Despesas registadas')} value={nf(m.expenses_total)} hint={`${nf(m.expenses_30d)} ${L('em 30 dias')}`} />
        <Stat label={L('Metas criadas')} value={nf(m.goals_total)} hint={`${pct(m.pct_with_goal)} ${L('das contas têm metas')}`} />
        <Stat label={L('Despesas por utilizador ativo')} value={m.mau ? (m.expenses_30d / m.mau).toFixed(1) : '—'} hint={L('últimos 30 dias')} />
        <Stat label={L('Tempo médio por dia')} value={m.avg_session_min === null ? '—' : `${m.avg_session_min} min`} hint={L('por pessoa, quando abre a app')} />
        <Stat label={L('Frequência')} value={m.days_per_user_30 === null ? '—' : `${m.days_per_user_30} ${L('dias')}`} hint={L('dias ativos por pessoa em 30')} />
        <Stat label={L('Usam relatórios')} value={pct(m.pct_reports)} hint={L('Resumo, calendário ou resumos do mês/ano')} />
        <Stat label={L('Registos hoje')} value={nf(m.signups_today)} />
      </div>

      <div className="dsh-row2">
        <section className="dsh-card"><header><h3>{L('Adoção de funcionalidades')}</h3><small>{L('% das contas que usam cada funcionalidade')}</small></header><HBars data={adoption} suffix="%" /></section>
        <section className="dsh-card"><header><h3>{L('Ecrãs mais usados')}</h3><small>{L('Minutos nos últimos 30 dias')}</small></header><HBars data={pages} /></section>
      </div>

      <h2 className="dsh-h2">{L('Saúde técnica')}</h2>
      <div className="dsh-stats">
        <Stat label={L('Base de dados')} value={<span className="dsh-ok">● {L('Online')}</span>} hint={ping.db === null ? '…' : ping.db < 0 ? L('Sem resposta') : `${ping.db} ms ${L('de resposta')}`} />
        <Stat label={L('Autenticação')} value={ping.auth === null ? '…' : <span className={ping.auth ? 'dsh-ok' : 'dsh-bad'}>● {ping.auth ? L('Online') : L('Com problemas')}</span>} />
        <Stat label={L('Tamanho da base de dados')} value={mb(m.db_size)} hint={`${nf(m.rows.transactions)} ${L('movimentos')}`} />
        <Stat label={L('Erros da app (7 dias)')} value={nf(m.errors_7d)} />
        <Stat label={L('Notificações push')} value="—" hint={L('A app ainda não envia notificações push')} />
      </div>
      <div className="dsh-row2">
        <section className="dsh-card"><header><h3>{L('Erros por versão')}</h3><small>{L('Últimos 7 dias')}</small></header><HBars data={m.errors_by_version} /></section>
        <section className="dsh-card"><header><h3>{L('Erros mais frequentes')}</h3><small>{L('Últimos 7 dias')}</small></header><HBars data={m.errors_top} /></section>
      </div>

      <div className="dsh-row3">
        <section className="dsh-card"><header><h3>{L('Suporte')}</h3><small>{L('Tickets vindos da app')}</small></header>
          <div className="dsh-sub2"><span>{L('Abertos')} <b>{nf(m.tickets_open)}</b></span><span>{L('Resolvidos (30d)')} <b>{nf(m.tickets_done_30d)}</b></span></div>
          <Donut data={m.tickets_by_kind} />
          <p className="dsh-note">{L('Avaliações nas lojas e desinstalações: só ficam disponíveis quando a app estiver na Play Store / App Store.')}</p>
        </section>
        <section className="dsh-card"><header><h3>{L('Segurança')}</h3><small>{L('Só números agregados')}</small></header>
          <div className="dsh-kvs">
            <p><span>{L('Contas suspensas')}</span><b>{nf(m.suspended)}</b></p>
            <p><span>{L('Contas eliminadas (30d)')}</span><b>{nf(m.deleted_30d)}</b></p>
            <p><span>{L('Emails por confirmar')}</span><b>{nf(m.unconfirmed)}</b></p>
            <p><span>{L('Máx. registos numa hora (24h)')}</span><b className={m.max_signups_hour_24h > 20 ? 'fx-neg' : ''}>{nf(m.max_signups_hour_24h)}</b></p>
          </div>
          {m.max_signups_hour_24h > 20 && <p className="fx-error">{L('Pico anormal de registos: verifica se não são contas falsas.')}</p>}
        </section>
        <section className="dsh-card"><header><h3>{L('Monetização')}</h3><small>{L('Estimativa com os preços mensais')}</small></header>
          <div className="dsh-kvs">
            <p><span>{L('Subscritores')}</span><b>{nf(paid)}</b></p>
            <p><span>{L('Conversão grátis → pago')}</span><b>{m.users ? `${((paid / m.users) * 100).toFixed(1)}%` : '—'}</b></p>
            <p><span>MRR</span><b>{eur(mrr)}</b></p>
            <p><span>ARR</span><b>{eur(mrr * 12)}</b></p>
            <p><span>{L('Churn de subscritores (30d)')}</span><b>{churnSubs === null ? '—' : `${churnSubs}%`}</b></p>
            <p><span>{L('LTV estimado')}</span><b>{ltv === null ? '—' : eur(ltv)}</b></p>
          </div>
        </section>
      </div>
    </div>
  );
}
