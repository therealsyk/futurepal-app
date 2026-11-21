// Consumer Intelligence: estatística agregada e anonimizada, dentro do painel de administração.
// Os números vêm só de public.ci_get (servidor): mínimo de 10 pessoas por valor, sem dados individuais.
// A mesma função servirá, no futuro, uma API B2B (sem acesso ao painel nem às tabelas das pessoas).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdminSupabase as getSupabase } from '../auth/supabase';
import { PickMenu, catLabel } from '../ui/fx';
import { L } from '../i18n/phrases';
import { Donut, HBars, Spark, Stat } from './AdminDash';

export type CIPage = 'ci_overview' | 'ci_categories' | 'ci_trends' | 'ci_savings' | 'ci_quality' | 'ci_reports';
type Range = '3m' | '6m' | '12m' | 'ytd' | 'lastyear';
const iso = (d: Date) => d.toLocaleDateString('sv-SE');
function rangeOf(r: Range): { from: string; to: string } {
  const n = new Date(), y = n.getFullYear();
  if (r === 'ytd') return { from: `${y}-01-01`, to: iso(n) };
  if (r === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  const m = r === '3m' ? 3 : r === '6m' ? 6 : 12;
  return { from: iso(new Date(y, n.getMonth() - m + 1, 1)), to: iso(n) };
}
const KIND: Record<CIPage, string> = { ci_overview: 'overview', ci_categories: 'categories', ci_trends: 'trends', ci_savings: 'savings', ci_quality: 'quality', ci_reports: 'overview' };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function AdminCI({ page }: { page: CIPage }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('12m');
  const [cur, setCur] = useState('EUR');
  const [cat, setCat] = useState('');
  const [curs, setCurs] = useState<string[]>(['EUR']);
  const [data, setData] = useState<any>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { from, to } = rangeOf(range);
  const catName = (k: string) => (k === 'custom' ? L('Outras / personalizadas') : catLabel(t, { name: k, nameKey: k }));
  const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }));
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
  const NA = L('Amostra insuficiente');

  const load = async (fresh = false) => {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    const { data: d, error } = await sb.rpc('ci_get', { p_kind: KIND[page], p_from: from, p_to: to, p_cur: cur, p_cat: page === 'ci_overview' || page === 'ci_reports' ? '' : cat, p_fresh: fresh });
    setBusy(false);
    if (error) { setErr(error.message.includes('allowed') ? L('Sem permissão.') : L('Corre o ficheiro supabase/ci.sql no Supabase.')); return; }
    setErr(null); setData(d);
  };
  useEffect(() => { load().catch(() => {}); }, [page, range, cur, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sb = getSupabase();
    sb?.rpc('ci_currencies').then(({ data: d }) => { if (Array.isArray(d) && d.length) setCurs(d as string[]); }, () => {});
    sb?.rpc('ci_get', { p_kind: 'overview', p_from: rangeOf('12m').from, p_to: iso(new Date()), p_cur: 'EUR', p_cat: '', p_fresh: false })
      .then(({ data: d }) => { if (d?.by_cat) setCats(Object.keys(d.by_cat)); }, () => {});
  }, []);

  const filters = (
    <div className="ad-filters ci-filters">
      <PickMenu label={L('Período')} value={range} onChange={(v) => setRange(v as Range)} options={[
        { value: '3m', label: L('Últimos 3 meses') }, { value: '6m', label: L('Últimos 6 meses') }, { value: '12m', label: L('Últimos 12 meses') },
        { value: 'ytd', label: L('Este ano') }, { value: 'lastyear', label: L('Ano passado') }]} />
      <PickMenu label={L('Moeda')} value={cur} onChange={(v) => setCur(String(v))} options={curs.map((c) => ({ value: c, label: c }))} />
      {page !== 'ci_overview' && page !== 'ci_reports' && page !== 'ci_quality' && (
        <PickMenu label={L('Categoria')} value={cat} onChange={(v) => setCat(String(v))} options={[{ value: '', label: L('Todas as categorias') }, ...cats.map((c) => ({ value: c, label: catName(c) }))]} />
      )}
      <span className="ci-k">🔒 {L('Mínimo de 10 pessoas por valor')}</span>
      <button type="button" className="fx-btn" disabled={busy} onClick={() => load(true)}>{busy ? '…' : L('Recalcular')}</button>
    </div>
  );
  const series = (rows: any[], key = 'v') => (rows ?? []).map((r) => Number(r[key]) || 0);
  const monthLabel = (m: string) => new Date(m + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

  if (err) return <>{filters}<p className="fx-muted">{err}</p></>;
  if (!data) return <>{filters}<p className="fx-muted">…</p></>;
  const d = data;

  return (
    <div className="dsh">
      {filters}
      {page === 'ci_overview' && <>
        <div className="dsh-stats">
          <Stat ic="user" label={L('Pessoas com dados')} value={d.users_with_data} hint={L('com pelo menos 3 despesas')} />
          <Stat ic="list" label={L('Despesas analisadas')} value={d.expenses?.toLocaleString()} />
          <Stat ic="chart" label={L('Volume total (interno)')} value={d.volume === null ? NA : money(d.volume)} />
          <Stat ic="target" label={L('Poupança mediana')} value={d.savings_rate === null ? NA : pct(d.savings_rate)} hint={`${d.savers} ${L('pessoas com rendimentos')}`} />
          <Stat ic="user" label={L('Média por pessoa')} value={d.avg_user === null ? NA : money(d.avg_user)} hint={L('despesas no período')} />
          <Stat ic="user" label={L('Mediana por pessoa')} value={d.median_user === null ? NA : money(d.median_user)} hint={L('metade gasta menos do que isto')} />
        </div>
        <div className="dsh-row2">
          <section className="dsh-card"><header><h3>{L('Evolução mensal dos gastos')}</h3><small>{L('Só meses com 10 ou mais pessoas')}</small></header><Spark data={series(d.monthly)} color="#2dd4bf" h={160} fill />
            <div className="ci-xlabels">{(d.monthly ?? []).map((r: any) => <span key={r.m}>{monthLabel(r.m)}</span>)}</div></section>
          <section className="dsh-card"><header><h3>{L('Peso por categoria')}</h3><small>{L('% do total de despesas')}</small></header>
            <Donut data={Object.fromEntries(Object.entries(d.by_cat ?? {}).map(([k, v]) => [catName(k), Number(v)]))} /></section>
        </div>
        <div className="dsh-row2">
          <section className="dsh-card"><header><h3>{L('Categorias com mais peso')}</h3></header>
            <HBars suffix="%" data={Object.fromEntries(Object.entries(d.by_cat ?? {}).map(([k, v]) => [catName(k), Number(v)]))} /></section>
          <section className="dsh-card"><header><h3>{L('Pessoas ativas com dados')}</h3><small>{L('Por mês')}</small></header><Spark data={series(d.active_users, 'u')} color="#8b7cf6" h={140} fill /></section>
        </div>
      </>}

      {page === 'ci_categories' && <>
        <section className="dsh-card"><header><h3>{L('Categorias')}</h3><small>{L('Média e mediana por pessoa no período; tendência = 2.ª metade vs 1.ª metade do período')}</small></header>
          {(d.rows ?? []).length === 0 ? <p className="fx-muted">{NA}</p> : (
            <div className="ad-table-wrap"><table className="ad-table">
              <thead><tr><th>{L('Categoria')}</th><th>{L('Peso')}</th><th>{L('Média')}</th><th>{L('Mediana')}</th><th>{L('Tendência')}</th></tr></thead>
              <tbody>{d.rows.map((r: any) => <tr key={r.cat}><td><b>{catName(r.cat)}</b></td><td>{pct(r.pct)}</td><td>{money(r.avg)}</td><td>{money(r.median)}</td>
                <td className={r.trend > 0 ? 'fx-neg' : r.trend < 0 ? 'fx-pos' : ''}>{r.trend === null ? '—' : `${r.trend > 0 ? '▲' : r.trend < 0 ? '▼' : '='} ${Math.abs(r.trend)}%`}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
        <section className="dsh-card"><header><h3>{L('Comparação entre categorias')}</h3><small>{L('Peso no total')}</small></header>
          <HBars suffix="%" data={Object.fromEntries((d.rows ?? []).map((r: any) => [catName(r.cat), Number(r.pct)]))} /></section>
      </>}

      {page === 'ci_trends' && <>
        <div className="dsh-stats">
          <Stat ic="chart" label={L('vs período anterior')} value={d.vs_prev === null ? NA : `${d.vs_prev > 0 ? '+' : ''}${d.vs_prev}%`} hint={L('mesma duração, logo antes')} />
          <Stat ic="cal" label={L('vs mesmo período do ano passado')} value={d.vs_year === null ? NA : `${d.vs_year > 0 ? '+' : ''}${d.vs_year}%`} />
          <Stat ic="user" label={L('Gasto por pessoa (agora)')} value={d.per_user_now === null ? NA : money(d.per_user_now)} />
          <Stat ic="user" label={L('Gasto por pessoa (antes)')} value={d.per_user_prev === null ? NA : money(d.per_user_prev)} />
        </div>
        <div className="dsh-row2">
          <section className="dsh-card"><header><h3>{L('Evolução mensal')}</h3></header><Spark data={series(d.monthly)} color="#2dd4bf" h={160} fill />
            <div className="ci-xlabels">{(d.monthly ?? []).map((r: any) => <span key={r.m}>{monthLabel(r.m)}</span>)}</div></section>
          <section className="dsh-card"><header><h3>{L('Por trimestre')}</h3></header>
            <HBars data={Object.fromEntries((d.quarterly ?? []).map((r: any) => [`${new Date(r.q + 'T00:00:00').getFullYear()} T${Math.floor(new Date(r.q + 'T00:00:00').getMonth() / 3) + 1}`, Number(r.v)]))} /></section>
        </div>
      </>}

      {page === 'ci_savings' && <>
        <p className="dsh-note">{L('Nem todas as pessoas registam os rendimentos: estes valores contam só quem regista rendimentos e despesas.')} ({d.savers} {L('pessoas')})</p>
        <div className="dsh-stats">
          <Stat ic="target" label={L('% do rendimento poupado')} value={d.rate_median === null ? NA : pct(d.rate_median)} hint={L('mediana por pessoa e mês')} />
          <Stat ic="chart" label={L('Poupança média')} value={d.saved_avg === null ? NA : money(d.saved_avg)} hint={L('por pessoa e mês')} />
          <Stat ic="chart" label={L('Poupança mediana')} value={d.saved_median === null ? NA : money(d.saved_median)} hint={L('por pessoa e mês')} />
          <Stat ic="target" label={L('Metas atingidas')} value={d.goals_reached_pct === null ? NA : pct(d.goals_reached_pct)} hint={`${d.goals} ${L('metas')}`} />
        </div>
        <div className="dsh-row2">
          <section className="dsh-card"><header><h3>{L('Evolução da poupança')}</h3><small>{L('% mediana do rendimento poupado')}</small></header><Spark data={series(d.monthly, 'rate')} color="#4ade80" h={150} fill /></section>
          <section className="dsh-card"><header><h3>{L('Tamanho das metas')}</h3><small>{L('Valor alvo')}</small></header><HBars data={d.goal_buckets ?? {}} /></section>
        </div>
      </>}

      {page === 'ci_quality' && <>
        <div className="dsh-stats">
          <Stat ic="user" label={L('Pessoas com registos suficientes')} value={d.users_sufficient} hint={`${L('de')} ${d.users} · ${L('5+ registos num mês')}`} />
          <Stat ic="list" label={L('Registos válidos')} value={d.records?.toLocaleString()} />
          <Stat ic="chart" label={L('Despesas com categoria da app')} value={pct(d.pct_categorized)} />
          <Stat ic="bug" label={L('Possíveis duplicados')} value={d.duplicates} hint={L('mesmo dia, valor e descrição')} />
          <Stat ic="list" label={L('Sem categoria')} value={d.uncategorized} hint={`${d.custom_cat} ${L('em categorias personalizadas')}`} />
          <Stat ic="key" label={L('Sem descrição')} value={d.no_description} />
          <Stat ic="cal" label={L('Cobertura temporal')} value={`${d.months} ${L('meses')}`} hint={d.first_day ? `${d.first_day} → ${d.last_day}` : '—'} />
        </div>
        <section className="dsh-card"><header><h3>{L('Evolução dos dados disponíveis')}</h3><small>{L('Registos por mês')}</small></header><Spark data={series(d.growth, 'n')} color="#60a5fa" h={150} fill /></section>
      </>}

      {page === 'ci_reports' && <CIReports from={from} to={to} cur={cur} catName={catName} />}
    </div>
  );
}

/** Relatórios: mensal / trimestral / comparação, exportados em CSV (só agregados) ou PDF (impressão). */
function CIReports({ from, to, cur, catName }: { from: string; to: string; cur: string; catName: (k: string) => string }) {
  const [kind, setKind] = useState<'month' | 'quarter'>('month');
  const [rows, setRows] = useState<Array<Record<string, string | number>>>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const build = async () => {
    const sb = getSupabase(); if (!sb) return;
    const [tr, ca] = await Promise.all([
      sb.rpc('ci_get', { p_kind: 'trends', p_from: from, p_to: to, p_cur: cur, p_cat: '', p_fresh: false }),
      sb.rpc('ci_get', { p_kind: 'categories', p_from: from, p_to: to, p_cur: cur, p_cat: '', p_fresh: false }),
    ]);
    if (tr.error || ca.error) { setMsg(L('Corre o ficheiro supabase/ci.sql no Supabase.')); return; }
    const per = (kind === 'month' ? tr.data.monthly : tr.data.quarterly) ?? [];
    const out: Array<Record<string, string | number>> = per.map((r: any) => ({ periodo: r.m ?? r.q, despesas_total: r.v, pessoas: r.u }));
    for (const c of ca.data.rows ?? []) out.push({ periodo: `${from}..${to}`, categoria: catName(c.cat), peso_pct: c.pct, media_pessoa: c.avg, mediana_pessoa: c.median, tendencia_pct: c.trend ?? '' });
    setRows(out); setMsg(null);
  };
  useEffect(() => { build().catch(() => {}); }, [kind, from, to, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = useMemo(() => Array.from(new Set(rows.flatMap((r) => Object.keys(r)))), [rows]);
  const csv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = `consumer-intelligence-${kind}-${from}-${to}.csv`; a.click();
  };
  return (
    <section className="dsh-card">
      <header><h3>{L('Relatórios')}</h3><small>{L('Só indicadores agregados (mínimo de 10 pessoas por valor). Nada de dados individuais.')}</small></header>
      <div className="ad-filters">
        <PickMenu label={L('Tipo')} value={kind} onChange={(v) => setKind(v as 'month' | 'quarter')} options={[{ value: 'month', label: L('Relatório mensal') }, { value: 'quarter', label: L('Relatório trimestral') }]} />
        <button type="button" className="fx-btn primary" onClick={csv} disabled={!rows.length}>{L('Exportar CSV')}</button>
        <button type="button" className="fx-btn" onClick={() => window.print()}>{L('Exportar PDF')}</button>
      </div>
      {msg ? <p className="fx-muted">{msg}</p> : rows.length === 0 ? <p className="fx-muted">{L('Amostra insuficiente')}</p> : (
        <div className="ad-table-wrap"><table className="ad-table">
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}
