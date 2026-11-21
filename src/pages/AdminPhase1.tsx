// Administração — Fase 1: atividade (DAU/WAU/MAU, retenção), utilizadores (pseudónimos), tickets, auditoria e 2FA.
// Precisa de supabase/admin_phase1.sql. Privacidade: nada aqui mostra valores, despesas, categorias ou metas.
import { useEffect, useState } from 'react';
import { getSupabase } from '../auth/supabase';
import { loadSettings } from '../core/settings';
import { Sheet } from '../ui/fx';
import { L } from '../i18n/phrases';

export type AdminTab = 'overview' | 'live' | 'users' | 'plans' | 'tickets' | 'versions' | 'audit' | 'security';
const sb = () => getSupabase()!;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString(loadSettings().language, { dateStyle: 'short', timeStyle: 'short' }) : '—');
const ago = (d?: string | null) => {
  if (!d) return { dot: 'off', text: L('Nunca') };
  const m = (Date.now() - new Date(d).getTime()) / 60000;
  if (m < 5) return { dot: 'now', text: L('Ativo agora') };
  if (m < 1440) return { dot: 'day', text: L('Últimas 24h') };
  if (m < 10080) return { dot: 'week', text: L('Últimos 7 dias') };
  return { dot: 'off', text: L('Inativo') + ' ' + Math.round(m / 1440) + 'd' };
};
const ERR_SQL = 'Corre o ficheiro supabase/admin_phase1.sql no Supabase.';

export function AdminTabs({ tab, onTab }: { tab: AdminTab; onTab: (t: AdminTab) => void }) {
  const tabs: Array<[AdminTab, string]> = [['overview', 'Visão geral'], ['users', 'Utilizadores'], ['tickets', 'Tickets'], ['audit', 'Auditoria'], ['security', 'Segurança']];
  return (
    <div className="ad-tabs" role="tablist">
      {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}>{L(label)}</button>)}
    </div>
  );
}

export function AdminPhase1({ tab }: { tab: AdminTab }) {
  if (tab === 'users') return <UsersPanel />;
  if (tab === 'tickets') return <TicketsPanel />;
  if (tab === 'audit') return <AuditPanel />;
  if (tab === 'security') return <SecurityPanel />;
  return null;
}

/** Visão geral: DAU/WAU/MAU, crescimento, retenção e churn + gráfico de ativos por dia. */
type Act = { dau: number; wau: number; mau: number; wau_prev: number; mau_prev: number; daily: Array<{ day: string; n: number }>; ret_d1: number | null; ret_d7: number | null; ret_d30: number | null; churn: number | null };
export function AdminActivity() {
  const [a, setA] = useState<Act | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { sb().rpc('admin_activity').then(({ data, error }) => { if (error) setErr(L(ERR_SQL)); else setA(data as Act); }, () => {}); }, []);
  if (err) return <p className="fx-muted fx-small">{err}</p>;
  if (!a) return null;
  const growth = (n: number, p: number) => (p > 0 ? `${n >= p ? '+' : ''}${Math.round(((n - p) / p) * 100)}%` : '—');
  const max = Math.max(1, ...a.daily.map((d) => d.n));
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
  const cards: Array<[string, string | number, string?]> = [
    ['DAU', a.dau], ['WAU', a.wau, growth(a.wau, a.wau_prev)], ['MAU', a.mau, growth(a.mau, a.mau_prev)],
    [L('Retenção D1'), pct(a.ret_d1)], [L('Retenção D7'), pct(a.ret_d7)], [L('Retenção D30'), pct(a.ret_d30)], [L('Churn mensal'), pct(a.churn)],
  ];
  return (
    <>
      <div className="pm-wrapped">{cards.map(([l, v, g]) => <div key={l} className="pm-wcard"><small>{l}</small><strong>{v}</strong>{g && <small className={g.startsWith('-') ? 'fx-neg' : 'fx-pos'}>{g} {L('vs período anterior')}</small>}</div>)}</div>
      <div className="fx-card ad-card">
        <h3>{L('Utilizadores ativos por dia (90 dias)')}</h3>
        <div className="ad-bars">{a.daily.map((d) => <i key={d.day} title={`${d.day}: ${d.n}`} style={{ height: `${(d.n / max) * 100}%` }} />)}</div>
      </div>
    </>
  );
}

/** Utilizadores: lista pseudónima com filtros, detalhe e ações com motivo obrigatório. */
type URow = { id: string; ref: string; email_masked: string; plan: string; plan_until: string | null; status: string; platform: string | null; app_version: string | null; created_at: string; last_seen: string | null; total: number };
function UsersPanel() {
  const [rows, setRows] = useState<URow[]>([]);
  const [f, setF] = useState({ search: '', plan: '', status: '', platform: '', active: '' });
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<URow | null>(null);
  const load = async (p = page) => {
    const { data, error } = await sb().rpc('admin_user_list', { p_search: f.search, p_plan: f.plan, p_status: f.status, p_platform: f.platform, p_active: f.active, max_rows: 50, p_offset: p * 50 });
    if (error) { setErr(error.message.includes('allowed') ? L('Sem permissão.') : L(ERR_SQL)); return; }
    setErr(null); setRows((data ?? []) as URow[]);
  };
  useEffect(() => { load(0).catch(() => {}); setPage(0); }, [f.plan, f.status, f.platform, f.active]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows[0]?.total ?? 0;
  const sel = (k: keyof typeof f, opts: Array<[string, string]>) => (
    <select className="fx-input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  );
  return (
    <div className="fx-card ad-card">
      <div className="ad-filters">
        <form onSubmit={(e) => { e.preventDefault(); load(0); setPage(0); }} className="ad-search">
          <input className="fx-input" value={f.search} placeholder={L('Pesquisar por ID (U-…) ou email exato')} onChange={(e) => setF({ ...f, search: e.target.value })} />
          <button type="submit" className="fx-btn primary">{L('Pesquisar')}</button>
        </form>
        {sel('plan', [['', L('Todos os planos')], ['free', 'Free'], ['plus', 'Plus'], ['family', 'Family'], ['pro', 'Pro']])}
        {sel('status', [['', L('Todos os estados')], ['active', L('Ativa')], ['unconfirmed', L('Por confirmar')], ['suspended', L('Suspensa')]])}
        {sel('platform', [['', L('Todas as plataformas')], ['android', 'Android'], ['windows', 'Windows'], ['web', 'Web'], ['ios', 'iOS']])}
        {sel('active', [['', L('Qualquer atividade')], ['now', L('Ativo agora')], ['24h', L('Últimas 24h')], ['7d', L('Últimos 7 dias')], ['inactive', L('Inativo há +30 dias')]])}
      </div>
      {err ? <p className="fx-muted">{err}</p> : (
        <div className="ad-table-wrap"><table className="ad-table">
          <thead><tr><th>ID</th><th>Email</th><th>{L('Plano')}</th><th>{L('Estado')}</th><th>{L('Plataforma')}</th><th>{L('Registo')}</th><th>{L('Atividade')}</th></tr></thead>
          <tbody>{rows.map((r) => { const a = ago(r.last_seen); return (
            <tr key={r.id} className="ad-row" onClick={() => setOpen(r)}>
              <td><b>{r.ref}</b></td><td>{r.email_masked}</td><td>{r.plan}</td><td><span className={'ad-st ' + r.status}>{L(r.status === 'active' ? 'Ativa' : r.status === 'suspended' ? 'Suspensa' : 'Por confirmar')}</span></td>
              <td>{r.platform ? `${r.platform} ${r.app_version ?? ''}` : '—'}</td><td>{new Date(r.created_at).toLocaleDateString(loadSettings().language)}</td>
              <td><i className={'ad-act ' + a.dot} />{a.text}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
      <div className="ad-pager">
        <span className="fx-muted fx-small">{total} {L('contas')}</span>
        <button type="button" className="fx-btn" disabled={page === 0} onClick={() => { setPage(page - 1); load(page - 1); }}>‹</button>
        <button type="button" className="fx-btn" disabled={(page + 1) * 50 >= total} onClick={() => { setPage(page + 1); load(page + 1); }}>›</button>
      </div>
      {open && <UserDetail row={open} onClose={() => setOpen(null)} onChanged={() => load()} />}
    </div>
  );
}

type Detail = { ref: string; email: string; created_at: string; confirmed: boolean; suspended_until: string | null; provider: string;
  plan: { plan: string; status: string; until: string; source: string } | null; presence: { platform: string; version: string; last_seen: string } | null;
  counts: { transactions: number; goals: number; active_days_30: number };
  plan_history: Array<{ at: string; from: string; to: string; until: string | null; reason: string; by: string }>; audit: Array<{ at: string; action: string; reason: string | null; by: string }> };
function UserDetail({ row, onClose, onChanged }: { row: URow; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [action, setAction] = useState<null | 'plan' | 'suspend' | 'reactivate' | 'logout' | 'delete'>(null);
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState('plus');
  const [until, setUntil] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => sb().rpc('admin_user_detail', { p_user: row.id }).then(({ data }) => setD(data as Detail), () => {});
  useEffect(() => { load(); }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    if (!reason.trim()) { setMsg(L('Escreve o motivo.')); return; }
    if (action === 'delete' && confirmText.trim().toLowerCase() !== (d?.email ?? '').toLowerCase()) { setMsg(L('Escreve o email da conta para confirmar.')); return; }
    const calls = {
      plan: () => sb().rpc('admin_change_plan', { p_user: row.id, p_plan: plan, p_until: until ? new Date(until).toISOString() : null, p_reason: reason }),
      suspend: () => sb().rpc('admin_set_suspended', { p_user: row.id, p_suspend: true, p_reason: reason }),
      reactivate: () => sb().rpc('admin_set_suspended', { p_user: row.id, p_suspend: false, p_reason: reason }),
      logout: () => sb().rpc('admin_force_logout', { p_user: row.id, p_reason: reason }),
      delete: () => sb().rpc('admin_delete_account', { p_user: row.id, p_reason: reason }),
    };
    const { error } = await calls[action!]();
    if (error) { setMsg(error.message); return; }
    setMsg(L('Feito.')); setAction(null); setReason(''); setConfirmText(''); onChanged();
    if (action === 'delete') onClose(); else load();
  };
  const suspended = !!d?.suspended_until && new Date(d.suspended_until) > new Date();
  return (
    <Sheet open onClose={onClose} title={`${L('Conta')} ${row.ref}`}>
      {!d ? <p className="fx-muted">…</p> : (<>
        <div className="ad-kvs">
          <p className="ad-kv"><span>Email</span><b>{showEmail ? d.email : row.email_masked} {!showEmail && <button type="button" className="ad-link" onClick={() => setShowEmail(true)}>{L('mostrar')}</button>}</b></p>
          <p className="ad-kv"><span>{L('Registo')}</span><b>{fmtDate(d.created_at)} · {d.provider}{d.confirmed ? '' : ' · ' + L('Por confirmar')}</b></p>
          <p className="ad-kv"><span>{L('Plano')}</span><b>{d.plan ? `${d.plan.plan} · ${d.plan.status} · ${L('até')} ${fmtDate(d.plan.until)}` : 'free'}</b></p>
          <p className="ad-kv"><span>{L('Estado')}</span><b className={suspended ? 'fx-neg' : 'fx-pos'}>{suspended ? L('Suspensa') : L('Ativa')}</b></p>
          <p className="ad-kv"><span>{L('Plataforma')}</span><b>{d.presence ? `${d.presence.platform} ${d.presence.version} · ${ago(d.presence.last_seen).text}` : '—'}</b></p>
          <p className="ad-kv"><span>{L('Utilização (só contagens)')}</span><b>{d.counts.transactions} {L('movimentos')} · {d.counts.goals} {L('metas')} · {d.counts.active_days_30} {L('dias ativos (30d)')}</b></p>
        </div>
        <h4 className="ad-h4">{L('Mudar plano')}</h4>
        <div className="ad-plans">
          {['free', 'plus', 'family', 'pro'].map((p) => {
            const curPlan = d.plan && ['active', 'trialing'].includes(d.plan.status) && new Date(d.plan.until) > new Date() ? d.plan.plan : 'free';
            return <button key={p} type="button" className={'ad-plan' + (curPlan === p ? ' cur' : '') + (action === 'plan' && plan === p ? ' on' : '')}
              onClick={() => { setPlan(p); setAction('plan'); setMsg(null); }}>{p === 'free' ? 'Free' : p.charAt(0).toUpperCase() + p.slice(1)}{curPlan === p && <small>{L('atual')}</small>}</button>;
          })}
        </div>
        <div className="ad-actions">
          <button type="button" className="fx-btn" onClick={() => setAction('logout')}>{L('Forçar logout')}</button>
          {suspended ? <button type="button" className="fx-btn" onClick={() => setAction('reactivate')}>{L('Reativar')}</button>
            : <button type="button" className="fx-btn" onClick={() => setAction('suspend')}>{L('Suspender')}</button>}
          <button type="button" className="fx-btn danger" onClick={() => setAction('delete')}>{L('Eliminar conta')}</button>
        </div>
        {action && (
          <div className="ad-confirm">
            {action === 'plan' && <div className="fx-inline" style={{ gap: 8, alignItems: 'center' }}>
              <b>{L('Novo plano')}: {plan}</b>
              {plan !== 'free' && <><span className="fx-muted fx-small">{L('até')}</span><input className="fx-input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label={L('até')} /><span className="fx-muted fx-small">{L('(vazio = 1 ano)')}</span></>}
            </div>}
            <textarea className="fx-input" rows={2} maxLength={500} value={reason} placeholder={L('Motivo (obrigatório, fica na auditoria)')} onChange={(e) => setReason(e.target.value)} />
            {action === 'delete' && <input className="fx-input" value={confirmText} placeholder={L('Escreve o email da conta para confirmar')} onChange={(e) => setConfirmText(e.target.value)} />}
            <div className="fx-inline" style={{ gap: 8 }}>
              <button type="button" className="fx-btn" onClick={() => { setAction(null); setMsg(null); }}>{L('Cancelar')}</button>
              <button type="button" className={'fx-btn ' + (action === 'delete' || action === 'suspend' ? 'danger' : 'primary')} onClick={run}>{L('Confirmar')}</button>
            </div>
          </div>
        )}
        {msg && <p className="fx-muted fx-small">{msg}</p>}
        <h4 className="ad-h4">{L('Histórico de planos')}</h4>
        {d.plan_history.length === 0 ? <p className="fx-muted fx-small">—</p> : d.plan_history.map((h, i) => <p key={i} className="ad-kv"><span>{fmtDate(h.at)} · {h.by ?? '—'}</span><b>{h.from} → {h.to}{h.reason ? ` · ${h.reason}` : ''}</b></p>)}
        <h4 className="ad-h4">{L('Ações de administração')}</h4>
        {d.audit.filter((a) => a.action !== 'view_user').length === 0 ? <p className="fx-muted fx-small">—</p> : d.audit.filter((a) => a.action !== 'view_user').map((a, i) => <p key={i} className="ad-kv"><span>{fmtDate(a.at)} · {a.by ?? '—'}</span><b>{a.action}{a.reason ? ` · ${a.reason}` : ''}</b></p>)}
      </>)}
    </Sheet>
  );
}

/** Tickets: o feedback da app com estado, prioridade e notas internas. Resposta por email. */
type Ticket = { id: string; created_at: string; email: string | null; kind: string; message: string; app_version: string | null; platform: string | null; status: string; priority: string; admin_notes: string | null };
const ST: Array<[string, string]> = [['new', 'Novo'], ['progress', 'Em análise'], ['waiting', 'À espera do utilizador'], ['done', 'Resolvido'], ['closed', 'Fechado'], ['reopened', 'Reaberto']];
const PR: Array<[string, string]> = [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['urgent', 'Urgente']];
function TicketsPanel() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [st, setSt] = useState('open');
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = async () => {
    let q = sb().from('feedback').select('id, created_at, email, kind, message, app_version, platform, status, priority, admin_notes').order('created_at', { ascending: false }).limit(200);
    if (st === 'open') q = q.in('status', ['new', 'progress', 'waiting', 'reopened']); else if (st) q = q.eq('status', st);
    const { data, error } = await q;
    if (error) { setErr(L(ERR_SQL)); return; }
    setErr(null); setRows((data ?? []) as Ticket[]);
  };
  useEffect(() => { load().catch(() => {}); }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = async (t: Ticket, patch: { status?: string; priority?: string; notes?: string }) => {
    const { error } = await sb().rpc('admin_ticket_update', { p_id: t.id, p_status: patch.status ?? null, p_priority: patch.priority ?? null, p_notes: patch.notes ?? null });
    if (error) setErr(error.message); else load();
  };
  const counts = { open: rows.filter((r) => !['done', 'closed'].includes(r.status)).length, urgent: rows.filter((r) => r.priority === 'urgent' && !['done', 'closed'].includes(r.status)).length };
  return (
    <div className="fx-card ad-card">
      <div className="ad-filters">
        <select className="fx-input" value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="open">{L('Abertos')}</option><option value="">{L('Todos')}</option>{ST.map(([v, l]) => <option key={v} value={v}>{L(l)}</option>)}
        </select>
        <span className="fx-muted fx-small">{counts.open} {L('abertos')} · {counts.urgent} {L('urgentes')}</span>
      </div>
      {err && <p className="fx-muted">{err}</p>}
      <div className="ad-fb-list">
        {rows.map((t) => {
          const hours = Math.round((Date.now() - new Date(t.created_at).getTime()) / 36e5);
          return (
            <div key={t.id} className={'ad-ticket p-' + t.priority}>
              <div className="ad-fb-meta">
                <b>T-{t.id.slice(0, 6).toUpperCase()}</b><span>{t.kind}</span><span>{t.platform ?? '—'} {t.app_version ?? ''}</span><span>{fmtDate(t.created_at)}</span>
                {t.status === 'new' && hours >= 20 && <span className="fx-neg">⚠ {L('Sem resposta há')} {hours}h</span>}
              </div>
              <p className="ad-ticket-msg">{t.message}</p>
              <div className="fx-inline ad-ticket-ctl">
                <select className="fx-input" value={t.status} onChange={(e) => upd(t, { status: e.target.value })}>{ST.map(([v, l]) => <option key={v} value={v}>{L(l)}</option>)}</select>
                <select className="fx-input" value={t.priority} onChange={(e) => upd(t, { priority: e.target.value })}>{PR.map(([v, l]) => <option key={v} value={v}>{L(l)}</option>)}</select>
                {t.email && <a className="fx-btn" href={`mailto:${t.email}?subject=${encodeURIComponent('FuturePal — T-' + t.id.slice(0, 6).toUpperCase())}`}>{L('Responder por email')}</a>}
              </div>
              <div className="fx-inline ad-ticket-ctl">
                <input className="fx-input" value={notes[t.id] ?? t.admin_notes ?? ''} placeholder={L('Notas internas (não vão para o utilizador)')} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
                <button type="button" className="fx-btn" onClick={() => upd(t, { notes: notes[t.id] ?? '' })}>{L('Guardar')}</button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && !err && <p className="fx-muted">{L('Sem tickets.')}</p>}
      </div>
    </div>
  );
}

/** Auditoria: todas as ações administrativas, com exportação para CSV. */
type Audit = { created_at: string; admin_email: string | null; action: string; target: string | null; reason: string | null };
function AuditPanel() {
  const [rows, setRows] = useState<Audit[]>([]);
  const [target, setTarget] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    const { data, error } = await sb().rpc('admin_audit_list', { p_target: target.trim().toUpperCase(), max_rows: 500 });
    if (error) { setErr(L(ERR_SQL)); return; }
    setErr(null); setRows((data ?? []) as Audit[]);
  };
  useEffect(() => { load().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const csv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = ['data,admin,acao,alvo,motivo', ...rows.map((r) => [r.created_at, r.admin_email, r.action, r.target, r.reason].map(esc).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'auditoria.csv'; a.click();
  };
  return (
    <div className="fx-card ad-card">
      <div className="ad-filters">
        <form className="ad-search" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <input className="fx-input" value={target} placeholder={L('Filtrar por ID (U-…)')} onChange={(e) => setTarget(e.target.value)} />
          <button type="submit" className="fx-btn primary">{L('Filtrar')}</button>
        </form>
        <button type="button" className="fx-btn" onClick={csv} disabled={!rows.length}>{L('Exportar CSV')}</button>
      </div>
      {err ? <p className="fx-muted">{err}</p> : (
        <div className="ad-table-wrap"><table className="ad-table">
          <thead><tr><th>{L('Data')}</th><th>Admin</th><th>{L('Ação')}</th><th>{L('Alvo')}</th><th>{L('Motivo')}</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{fmtDate(r.created_at)}</td><td>{r.admin_email ?? '—'}</td><td>{r.action}</td><td>{r.target ?? '—'}</td><td>{r.reason ?? '—'}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

/** Segurança: papel atual e verificação em dois passos (2FA) com uma app autenticadora. */
function SecurityPanel() {
  const [role, setRole] = useState<string | null>(null);
  const [factors, setFactors] = useState<Array<{ id: string; status: string }>>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    sb().rpc('admin_role').then(({ data }) => setRole((data as string) ?? null), () => {});
    const { data } = await sb().auth.mfa.listFactors();
    setFactors((data?.totp ?? []).map((f) => ({ id: f.id, status: f.status })));
  };
  useEffect(() => { load().catch(() => {}); }, []);
  const start = async () => {
    const { data, error } = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'FuturePal Admin' });
    if (error) { setMsg(error.message); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const verify = async () => {
    if (!enroll) return;
    const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
    if (error) { setMsg(L('Código errado. Tenta outra vez.')); return; }
    setEnroll(null); setCode(''); setMsg(L('2FA ativado. A partir de agora o painel pede o código.')); load();
  };
  const active = factors.some((f) => f.status === 'verified');
  return (
    <div className="fx-grid2">
      <div className="fx-card ad-card">
        <h3>{L('O teu papel')}</h3>
        <p className="ad-kv"><span>{L('Papel')}</span><b>{role ?? '—'}</b></p>
        <p className="fx-muted fx-small">{L('Papéis: super (tudo), admin (contas, planos, configurações), support (tickets e ações básicas), finance (planos), readonly (só ver). Dá papéis no Supabase com o comando no fim do ficheiro admin_phase1.sql.')}</p>
      </div>
      <div className="fx-card ad-card">
        <h3>{L('Verificação em dois passos (2FA)')}</h3>
        <p className="ad-kv"><span>{L('Estado')}</span><b className={active ? 'fx-pos' : 'fx-neg'}>{active ? L('Ativa') : L('Desligada')}</b></p>
        {!active && !enroll && <button type="button" className="fx-btn primary" onClick={start}>{L('Ativar 2FA')}</button>}
        {enroll && (<>
          <p className="fx-muted fx-small">{L('Lê o código QR com uma app autenticadora (Google Authenticator, Authy…) e escreve o código de 6 dígitos.')}</p>
          <img className="ad-qr" src={enroll.qr} alt="QR" />
          <p className="fx-muted fx-small">{enroll.secret}</p>
          <div className="fx-inline" style={{ gap: 8 }}>
            <input className="fx-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
            <button type="button" className="fx-btn primary" onClick={verify} disabled={code.length !== 6}>{L('Confirmar')}</button>
          </div>
        </>)}
        {msg && <p className="fx-muted fx-small">{msg}</p>}
      </div>
    </div>
  );
}

/** Com 2FA ativo, pede o código ao abrir o painel (sessão aal2). Devolve true quando já está verificado. */
export function useAdminMfa(): { needCode: boolean; verify: (code: string) => Promise<boolean> } {
  const [need, setNeed] = useState<{ factorId: string } | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await sb().auth.mfa.getAuthenticatorAssuranceLevel();
      if (data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
        const f = (await sb().auth.mfa.listFactors()).data?.totp.find((x) => x.status === 'verified');
        if (f) setNeed({ factorId: f.id });
      }
    })().catch(() => {});
  }, []);
  return {
    needCode: !!need,
    verify: async (code: string) => {
      if (!need) return true;
      const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: need.factorId, code });
      if (!error) setNeed(null);
      return !error;
    },
  };
}

export function AdminMfaGate({ verify }: { verify: (code: string) => Promise<boolean> }) {
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div className="fx-card ad-card ad-mfa">
      <h3>{L('Verificação em dois passos')}</h3>
      <p className="fx-muted">{L('Escreve o código de 6 dígitos da tua app autenticadora.')}</p>
      <div className="fx-inline" style={{ gap: 8 }}>
        <input className="fx-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" autoFocus />
        <button type="button" className="fx-btn primary" disabled={code.length !== 6} onClick={async () => setBad(!(await verify(code)))}>{L('Entrar')}</button>
      </div>
      {bad && <p className="fx-error">{L('Código errado. Tenta outra vez.')}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Layout do painel (ao estilo shadcn-admin): barra lateral própria com grupos, barra de topo e conteúdo.
 * ---------------------------------------------------------------------------------------------- */
const NAV: Array<{ group: string; items: Array<{ id: AdminTab; label: string; desc: string; icon: string }> }> = [
  { group: 'Geral', items: [
    { id: 'overview', label: 'Dashboard', desc: 'Saúde do produto num relance: utilizadores, atividade e retenção.', icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' },
    { id: 'live', label: 'Tempo real', desc: 'Quem está a usar a app agora, avisos para todos e gestão rápida.', icon: 'M3 12h4l3-8 4 16 3-8h4' },
  ] },
  { group: 'Gestão', items: [
    { id: 'users', label: 'Utilizadores', desc: 'Contas e planos: pesquisa, filtros, mudar plano e ações com motivo.', icon: 'M16 19a4 4 0 0 0-8 0M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19a3 3 0 0 0-3-3M17 10a2.5 2.5 0 1 0 0-5' },
    { id: 'tickets', label: 'Tickets', desc: 'Pedidos de suporte e sugestões vindos da app.', icon: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5' },
  ] },
  { group: 'Sistema', items: [
    { id: 'versions', label: 'Versões', desc: 'Publicar versões e definir a versão mínima.', icon: 'M12 3v12M7 10l5 5 5-5M4 19h16' },
    { id: 'audit', label: 'Auditoria', desc: 'Todas as ações de administração: quem, quando e porquê.', icon: 'M9 5h10M9 12h10M9 19h10M5 5h.01M5 12h.01M5 19h.01' },
    { id: 'security', label: 'Segurança', desc: 'O teu papel e a verificação em dois passos (2FA).', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4' },
  ] },
];

export function AdminShell({ tab, onTab, onRefresh, children }: { tab: AdminTab; onTab: (t: AdminTab) => void; onRefresh: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const cur = NAV.flatMap((g) => g.items).find((i) => i.id === tab) ?? NAV[0].items[0];
  return (
    <div className="adm">
      <aside className={'adm-side' + (open ? ' open' : '')}>
        <div className="adm-brand"><span className="adm-logo">F</span><div><b>FuturePal</b><small>{L('Painel de administração')}</small></div></div>
        <nav className="adm-nav">
          {NAV.map((g) => (
            <div key={g.group} className="adm-group">
              <p>{L(g.group)}</p>
              {g.items.map((i) => (
                <button key={i.id} type="button" className={tab === i.id ? 'on' : ''} onClick={() => { onTab(i.id); setOpen(false); }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={i.icon} /></svg>{L(i.label)}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <a className="adm-back" href="#/">← {L('Voltar à app')}</a>
      </aside>
      {open && <div className="adm-scrim" onClick={() => setOpen(false)} />}
      <div className="adm-main">
        <header className="adm-top">
          <button type="button" className="adm-burger" onClick={() => setOpen(true)} aria-label="Menu">☰</button>
          <span className="adm-crumb">Admin <i>/</i> <b>{L(cur.label)}</b></span>
          <span style={{ flex: 1 }} />
          <button type="button" className="adm-tbtn" onClick={onRefresh} title={L('Atualizar')}>↻ <span>{L('Atualizar')}</span></button>
        </header>
        <div className="adm-content">
          <div className="adm-title"><h1>{L(cur.label)}</h1><p>{L(cur.desc)}</p></div>
          {children}
        </div>
      </div>
    </div>
  );
}
