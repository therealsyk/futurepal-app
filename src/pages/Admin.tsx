import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { PageHead, Field } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';

// Painel de administração (só para contas na tabela "admins" do Supabase; ver supabase/admin.sql).
// Mostra números agregados, as últimas contas criadas e permite publicar o aviso de versão nova.

type Stats = Record<string, number> & { providers: Record<string, number>; languages: Record<string, number>; signups_by_day: Array<{ day: string; n: number }> };
type UserRow = { email: string; created_at: string; last_sign_in_at: string | null; provider: string; confirmed: boolean; tx_count: number };
type SubRow = { email: string; plan: string; status: string; current_period_end: string | null; source: string; created_at: string };
type VersionRow = { platform: string; latest_version: string; min_version: string; notes: string; download_url: string; published_at: string };

/** true se a conta com sessão iniciada é administradora. */
export function useIsAdmin(): boolean {
  const auth = useAuth();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !auth.user) { setAdmin(false); return; }
    sb.rpc('is_admin').then(({ data }) => setAdmin(data === true), () => setAdmin(false));
  }, [auth.user]);
  return admin;
}

const date = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '—');

export function AdminPage() {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ platform: 'windows', version: '', min: '', notes: '', url: '' });
  const [saved, setSaved] = useState(false);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [subSearch, setSubSearch] = useState('');
  const [sub, setSub] = useState({ email: '', plan: 'plus', until: '' });
  const [subMsg, setSubMsg] = useState<string | null>(null);

  const load = async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [s, u, ver] = await Promise.all([sb.rpc('admin_stats'), sb.rpc('admin_users', { max_rows: 50 }), sb.from('app_versions').select('*').order('platform')]);
    if (s.error || u.error) { setError(String((s.error || u.error)?.message)); return; }
    setStats(s.data as Stats); setUsers((u.data ?? []) as UserRow[]); setVersions((ver.data ?? []) as VersionRow[]);
  };
  useEffect(() => { if (isAdmin) load().catch((e) => setError(String(e))); }, [isAdmin]);

  const loadSubs = async (q = subSearch) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data, error: e } = await sb.rpc('admin_subscriptions', { p_search: q.trim(), max_rows: 100 });
    if (e) { setError(e.message); return; }
    setSubs((data ?? []) as SubRow[]);
  };
  useEffect(() => { if (isAdmin) loadSubs('').catch((e) => setError(String(e))); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSub = async () => {
    const sb = getSupabase();
    if (!sb || !sub.email.trim()) return;
    setSubMsg(null);
    const until = sub.until ? new Date(sub.until + 'T23:59:59').toISOString() : null;
    const { error: e } = await sb.rpc('admin_set_subscription', { p_email: sub.email.trim(), p_plan: sub.plan, p_until: until });
    if (e) { setSubMsg(e.message.includes('user not found') ? t('admin.subNotFound') : e.message); return; }
    setSubMsg(t('admin.subSaved', { email: sub.email.trim(), plan: t('admin.plan_' + sub.plan) }));
    await loadSubs();
  };

  const publish = async () => {
    const sb = getSupabase();
    if (!sb || !v.version.trim()) return;
    const { error: e } = await sb.rpc('admin_set_version', { p_platform: v.platform, p_version: v.version.trim(), p_min: v.min.trim(), p_notes: v.notes.trim(), p_url: v.url.trim() });
    if (e) { setError(e.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2500); await load();
  };

  if (!isAdmin) return <div className="fx-page"><PageHead title={t('admin.title')} sub={t('admin.noAccess')} /></div>;

  const kpis: Array<[string, number | undefined]> = stats ? [
    [t('admin.usersTotal'), stats.users_total], [t('admin.users7d'), stats.users_7d], [t('admin.active7d'), stats.active_7d],
    [t('admin.active30d'), stats.active_30d], [t('admin.withData'), stats.with_data], [t('admin.unconfirmed'), stats.unconfirmed],
    [t('admin.txTotal'), stats.tx_total], [t('admin.tx30d'), stats.tx_30d], [t('admin.accounts'), stats.accounts_total], [t('admin.goals'), stats.goals_total],
  ] : [];
  const maxDay = Math.max(1, ...(stats?.signups_by_day ?? []).map((d) => d.n));

  return (
    <div className="fx-page">
      <PageHead title={t('admin.title')} sub={t('admin.sub')}>
        <button type="button" className="fx-btn" onClick={() => load()}>{t('admin.refresh')}</button>
      </PageHead>
      {error && <p className="fx-error">{error}</p>}
      <div className="pm-wrapped">{kpis.map(([l, n]) => <div key={l} className="pm-wcard"><small>{l}</small><strong>{n ?? '—'}</strong></div>)}</div>

      <div className="fx-card ad-card">
        <h3>{t('admin.signups30')}</h3>
        <div className="ad-bars">{(stats?.signups_by_day ?? []).map((d) => <i key={d.day} title={`${d.day}: ${d.n}`} style={{ height: `${(d.n / maxDay) * 100}%` }} />)}</div>
      </div>

      <div className="fx-two">
        <div className="fx-card ad-card"><h3>{t('admin.providers')}</h3>{Object.entries(stats?.providers ?? {}).map(([k, n]) => <p key={k} className="ad-kv"><span>{k}</span><b>{n}</b></p>)}</div>
        <div className="fx-card ad-card"><h3>{t('admin.languages')}</h3>{Object.entries(stats?.languages ?? {}).map(([k, n]) => <p key={k} className="ad-kv"><span>{k}</span><b>{n}</b></p>)}</div>
      </div>

      <div className="fx-card ad-card">
        <h3>{t('admin.latestUsers')}</h3>
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>{t('admin.email')}</th><th>{t('admin.created')}</th><th>{t('admin.lastSeen')}</th><th>{t('admin.provider')}</th><th>{t('admin.tx')}</th></tr></thead>
            <tbody>{users.map((u) => <tr key={u.email + u.created_at}><td>{u.email}{!u.confirmed && <small> · {t('admin.notConfirmed')}</small>}</td><td>{date(u.created_at)}</td><td>{date(u.last_sign_in_at)}</td><td>{u.provider}</td><td>{u.tx_count}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="fx-card ad-card">
        <h3>{t('admin.subsTitle')}</h3>
        <p className="fx-muted fx-small">{t('admin.subsHint')}</p>
        <div className="fx-two">
          <Field label={t('admin.email')}><input className="fx-input" value={sub.email} placeholder="pessoa@email.pt" onChange={(e) => setSub({ ...sub, email: e.target.value })} /></Field>
          <Field label={t('admin.subPlan')}>
            <select className="fx-input" value={sub.plan} onChange={(e) => setSub({ ...sub, plan: e.target.value })}>
              {['free', 'plus', 'family', 'pro'].map((p) => <option key={p} value={p}>{t('admin.plan_' + p)}</option>)}
            </select>
          </Field>
        </div>
        {sub.plan !== 'free' && <Field label={t('admin.subUntil')}><DatePicker value={sub.until} onChange={(v) => setSub({ ...sub, until: v })} allowEmpty /></Field>}
        <button type="button" className="fx-btn primary" onClick={saveSub}>{t('admin.subSave')}</button>
        {subMsg && <p className="fx-muted">{subMsg}</p>}
        <div className="as-input" style={{ marginTop: 14 }}>
          <input className="fx-input" value={subSearch} placeholder={t('admin.subSearch')} onChange={(e) => setSubSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadSubs(); }} />
          <button type="button" className="fx-btn" onClick={() => loadSubs()}>{t('admin.subSearchBtn')}</button>
        </div>
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>{t('admin.email')}</th><th>{t('admin.subPlan')}</th><th>{t('admin.subUntil')}</th><th>{t('admin.subSource')}</th><th /></tr></thead>
            <tbody>{subs.map((r) => (
              <tr key={r.email}>
                <td>{r.email}</td>
                <td><b>{t('admin.plan_' + r.plan)}</b>{r.plan === 'free' && r.status !== '—' && <small> · {r.status}</small>}</td>
                <td>{r.plan === 'free' ? '—' : date(r.current_period_end)}</td>
                <td>{r.source}</td>
                <td><button type="button" className="fx-link" onClick={() => setSub({ email: r.email, plan: r.plan === 'free' ? 'plus' : r.plan, until: '' })}>{t('admin.subChange')}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="fx-card ad-card">
        <h3>{t('admin.versions')}</h3>
        {versions.map((r) => <p key={r.platform} className="ad-kv"><span>{r.platform}</span><b>{r.latest_version}</b><small>{date(r.published_at)}</small></p>)}
        <div className="fx-two">
          <Field label={t('admin.platform')}><select className="fx-input" value={v.platform} onChange={(e) => setV({ ...v, platform: e.target.value })}>{['windows', 'android', 'ios', 'web'].map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label={t('admin.version')}><input className="fx-input" value={v.version} placeholder="0.2.0" onChange={(e) => setV({ ...v, version: e.target.value })} /></Field>
        </div>
        <div className="fx-two">
          <Field label={t('admin.minVersion')}><input className="fx-input" value={v.min} placeholder="0.0.0" onChange={(e) => setV({ ...v, min: e.target.value })} /></Field>
          <Field label={t('admin.url')}><input className="fx-input" value={v.url} placeholder="https://" onChange={(e) => setV({ ...v, url: e.target.value })} /></Field>
        </div>
        <Field label={t('admin.notes')}><input className="fx-input" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <button type="button" className="fx-btn primary" onClick={publish}>{saved ? t('admin.published') : t('admin.publish')}</button>
      </div>
      <p className="fx-muted fx-small">{t('admin.privacy')}</p>
    </div>
  );
}
