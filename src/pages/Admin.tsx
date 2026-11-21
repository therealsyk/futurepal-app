import { AdminLive } from './AdminLive';
import { AdminDashboard, AdminMoreMetrics } from './AdminDash';
import { PcOverview } from './PcOverview';
import { AdminLogin, AdminPhase1, AdminShell, allowedTab, isUnlocked, useAdminRole, type AdminTab } from './AdminPhase1';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdminSupabase as getSupabase, getSupabase as getAppSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { Field, PickMenu } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { githubLatest, GITHUB_REPO } from '../core/updates';
import { compareVersions } from '../core/version';

// Painel de administração (só para contas na tabela "admins" do Supabase; ver supabase/admin.sql).
// Mostra números agregados, as últimas contas criadas e permite publicar o aviso de versão nova.

type Stats = Record<string, number> & { providers: Record<string, number>; languages: Record<string, number>; signups_by_day: Array<{ day: string; n: number }> };
type UserRow = { email: string; created_at: string; last_sign_in_at: string | null; provider: string; confirmed: boolean; tx_count: number };
type SubRow = { email: string; plan: string; status: string; current_period_end: string | null; source: string; created_at: string };
type VersionRow = { platform: string; latest_version: string; min_version: string; notes: string; download_url: string; published_at: string };

/** true se a conta com sessão iniciada é administradora. */
/** A opção "Admin" no menu da conta só aparece ao administrador principal. */
export function useIsAdmin(): boolean {
  const auth = useAuth();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    const sb = getAppSupabase();
    if (!sb || !auth.user) { setAdmin(false); return; }
    sb.rpc('admin_role').then(({ data }) => setAdmin(data === 'super'), () => setAdmin(false));
  }, [auth.user]);
  return admin;
}

const date = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '—');

export function AdminPage() {
  const { t } = useTranslation();
  const [unlocked, setUnlocked] = useState(isUnlocked());
  const role = useAdminRole(unlocked);
  const isAdmin = unlocked && (role === 'super' || role === 'admin');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [interest, setInterest] = useState<Array<{ plan: string; period: string; n: number }>>([]);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [v, setV] = useState({ platform: 'windows', version: '', min: '', notes: '', url: '' });
  const [saved, setSaved] = useState(false);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [subSearch, setSubSearch] = useState('');
  const [sub, setSub] = useState({ email: '', plan: 'plus', until: '' });
  const [subMsg, setSubMsg] = useState<string | null>(null);
  // Feedback enviado pelas pessoas (supabase/feedback.sql)
  type FbRow = { id: string; created_at: string; email: string | null; kind: string; message: string; app_version: string | null; platform: string | null; status: string };
  const [fb, setFb] = useState<FbRow[]>([]);
  const [fbAll, setFbAll] = useState(false);
  const [fbErr, setFbErr] = useState<string | null>(null);
  const loadFb = async (all = fbAll) => {
    const sb = getSupabase();
    if (!sb) return;
    let q = sb.from('feedback').select('id,created_at,email,kind,message,app_version,platform,status').order('created_at', { ascending: false }).limit(100);
    if (!all) q = q.eq('status', 'new');
    const { data, error: e } = await q;
    if (e) { setFbErr(e.message); return; }
    setFbErr(null); setFb((data ?? []) as FbRow[]);
  };
  const markFb = async (id: string, status: 'new' | 'done') => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from('feedback').update({ status }).eq('id', id);
    await loadFb();
  };  void users; void fb; void setFbAll; void fbErr; void markFb; // lista antiga de contas/feedback: agora nos separadores Utilizadores e Tickets


  const load = async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [s, u, ver] = await Promise.all([sb.rpc('admin_stats'), sb.rpc('admin_users', { max_rows: 50 }), sb.from('app_versions').select('*').order('platform')]);
    if (s.error || u.error) { setError(String((s.error || u.error)?.message)); return; }
    setStats(s.data as Stats); setUsers((u.data ?? []) as UserRow[]);
    sb.rpc('admin_plan_interest').then(({ data }) => setInterest((data ?? []) as Array<{ plan: string; period: string; n: number }>), () => {});
    let rows = (ver.data ?? []) as VersionRow[];
    // As versões publicadas acompanham sozinhas a última release do GitHub (Windows e Android).
    const gh = await githubLatest();
    if (gh) {
      const notes = gh.notes.split('\n').map((l) => l.replace(/^[-*#\s]+/, '').trim()).filter(Boolean).join(' · ').slice(0, 300);
      const targets: Array<[string, string]> = [];
      if (gh.windows) targets.push(['windows', `https://github.com/${GITHUB_REPO}/releases/latest`]);
      if (gh.apkUrl) targets.push(['android', gh.apkUrl]);
      let changed = false;
      for (const [platform, url] of targets) {
        const row = rows.find((r) => r.platform === platform);
        if (row && compareVersions(gh.version, row.latest_version) <= 0) continue;
        const { error: e } = await sb.rpc('admin_set_version', { p_platform: platform, p_version: gh.version, p_min: row?.min_version ?? '', p_notes: notes, p_url: url });
        if (!e) changed = true;
      }
      if (changed) rows = ((await sb.from('app_versions').select('*').order('platform')).data ?? rows) as VersionRow[];
    }
    setVersions(rows);
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
  useEffect(() => { if (isAdmin) loadFb().catch(() => {}); }, [isAdmin, fbAll]); // eslint-disable-line react-hooks/exhaustive-deps

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

  void stats; void interest; // o Dashboard (AdminDash) carrega os seus próprios dados
  if (!unlocked) return <><PcOverview /><AdminLogin onDone={() => setUnlocked(true)} onCancel={() => { window.location.hash = '#/'; }} /></>;
  if (role === undefined) return <div className="fx-page ad-page" />;
  if (role === null) return <><PcOverview /><AdminLogin onDone={() => setUnlocked(true)} onCancel={() => { window.location.hash = '#/'; }} /></>;
  const shown: AdminTab = allowedTab(role, tab) ? tab : 'overview';
  return (
    <AdminShell tab={shown} onTab={setTab} onRefresh={() => load()} role={role}>
      {error && <p className="fx-error">{error}</p>}
      {shown === 'overview' && <AdminDashboard />}
      {shown === 'engagement' && <><AdminMoreMetrics section="engagement" /><AdminDashboard part="audience" /></>}
      {(shown === 'health' || shown === 'safety' || shown === 'money') && <AdminMoreMetrics section={shown} />}
      {shown === 'live' && <AdminLive />}
      {tab === 'plans' && (<>
      <div className="fx-card ad-card">
        <h3>{t('admin.subsTitle')}</h3>
        <p className="fx-muted fx-small">{t('admin.subsHint')}</p>
        <div className="fx-two">
          <Field label={t('admin.email')}><input className="fx-input" value={sub.email} placeholder="pessoa@email.pt" onChange={(e) => setSub({ ...sub, email: e.target.value })} /></Field>
          <Field label={t('admin.subPlan')}>
            <select className="fx-input" value={sub.plan} onChange={(e) => setSub({ ...sub, plan: e.target.value })}>
              {['free', 'plus', 'pro'].map((p) => <option key={p} value={p}>{t('admin.plan_' + p)}</option>)}
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

      </>)}
      {shown === 'versions' && (<>
      <div className="fx-card ad-card">
        <h3>{t('admin.versions')}</h3>
        {versions.map((r) => <p key={r.platform} className="ad-kv"><span>{r.platform}</span><b>{r.latest_version}</b><small>{date(r.published_at)}</small></p>)}
        <div className="fx-two">
          <Field label={t('admin.platform')}><PickMenu label={t('admin.platform')} value={v.platform} options={['windows', 'android', 'ios', 'web'].map((p) => ({ value: p, label: p }))} onChange={(x) => setV({ ...v, platform: String(x) })} /></Field>
          <Field label={t('admin.version')}><input className="fx-input" value={v.version} placeholder="0.2.0" onChange={(e) => setV({ ...v, version: e.target.value })} /></Field>
        </div>
        <div className="fx-two">
          <Field label={t('admin.minVersion')}><input className="fx-input" value={v.min} placeholder="0.0.0" onChange={(e) => setV({ ...v, min: e.target.value })} /></Field>
          <Field label={t('admin.url')}><input className="fx-input" value={v.url} placeholder="https://" onChange={(e) => setV({ ...v, url: e.target.value })} /></Field>
        </div>
        <Field label={t('admin.notes')}><input className="fx-input" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <button type="button" className="fx-btn primary" onClick={publish}>{saved ? t('admin.published') : t('admin.publish')}</button>
      </div>
      </>)}
      {(['users', 'tickets', 'audit', 'security', 'team'] as AdminTab[]).includes(shown) && <AdminPhase1 tab={shown} />}
      {shown === 'overview' && <p className="fx-muted fx-small">{t('admin.privacy')}</p>}
    </AdminShell>
  );
}
