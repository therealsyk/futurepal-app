// Administração (extra): quem está a usar a app agora, aviso para todos e apagar contas.
// Precisa de supabase/admin_extra.sql.
import { useEffect, useRef, useState } from 'react';
import { getAdminSupabase as getSupabase } from '../auth/supabase';
import { loadSettings } from '../core/settings';
import { L } from '../i18n/phrases';
import { PickMenu } from '../ui/fx';

type Online = { email: string; platform: string | null; app_version: string | null; page: string | null; last_seen: string };
type PStats = { now: number; today: number; week: number; platforms: Record<string, number>; versions: Record<string, number> };

export function AdminLive() {
  const lang = loadSettings().language;
  const [online, setOnline] = useState<Online[]>([]);
  const [ps, setPs] = useState<PStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ann, setAnn] = useState({ message: '', level: 'info', active: false });
  const [annMsg, setAnnMsg] = useState<string | null>(null);
  const [del, setDel] = useState('');
  const [delMsg, setDelMsg] = useState<string | null>(null);

  const load = async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [o, s] = await Promise.all([sb.rpc('admin_online', { p_minutes: 3 }), sb.rpc('admin_presence_stats')]);
    if (o.error) { setErr(L('Corre o ficheiro supabase/admin_extra.sql no Supabase para ver quem está online.')); return; }
    setErr(null); setOnline((o.data ?? []) as Online[]); setPs(s.data as PStats);
  };
  useEffect(() => {
    load().catch(() => {});
    const id = setInterval(() => { load().catch(() => {}); }, 20_000); // atualiza sozinho
    getSupabase()?.from('announcement').select('message, level, active').eq('id', 1).maybeSingle().then(({ data }) => { if (data) setAnn(data); }, () => {});
    return () => clearInterval(id);
  }, []);

  const saveAnn = async () => {
    const { error } = await getSupabase()!.rpc('admin_set_announcement', { p_message: ann.message.trim(), p_level: ann.level, p_active: ann.active });
    setAnnMsg(error ? error.message : L('Aviso guardado.'));
  };
  const deleteUser = async () => {
    if (!del.trim() || !window.confirm(L('Apagar esta conta e todos os dados dela? Não dá para desfazer.') + '\n' + del.trim())) return;
    const { data, error } = await getSupabase()!.rpc('admin_delete_user', { p_email: del.trim() });
    setDelMsg(error ? error.message : data ? L('Conta apagada.') : L('Não existe nenhuma conta com esse email.'));
    if (data) setDel('');
  };
  const ago = (iso: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`; };

  return (
    <>
      <div className="fx-card ad-card ad-live">
        <h3><span className="pco-mic ad-h3ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg></span>{L('Online agora')} <i className="ad-dot" /> <span className="ad-fb-count">{online.length}</span></h3>
        {err ? <p className="fx-muted">{err}</p> : (<>
          {ps && <div className="ad-lboxes">
            <LiveBox icon="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" label={L('Agora')} value={ps.now} live />
            <LiveBox icon="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" label={L('Hoje')} value={ps.today} />
            <LiveBox icon="M4 19V9M10 19V5M16 19v-7M22 19H2" label={L('Últimos 7 dias')} value={ps.week} />
            <LiveBox icon="M5 3h14v14H5zM9 21h6M12 17v4" label={L('Plataformas')} list={ps.platforms} />
            <LiveBox icon="M12 3v12M7 10l5 5 5-5M4 19h16" label={L('Versões')} list={ps.versions} />
          </div>}
          {online.length === 0 ? <p className="fx-muted">{L('Ninguém online neste momento.')}</p> : (
            <div className="ad-table-wrap"><table className="ad-table">
              <thead><tr><th>Email</th><th>{L('Plataforma')}</th><th>{L('Versão')}</th><th>{L('Página')}</th><th>{L('Visto há')}</th></tr></thead>
              <tbody>{online.map((o) => <tr key={o.email}><td>{o.email}</td><td>{o.platform ?? '—'}</td><td>{o.app_version ?? '—'}</td><td>{o.page ?? '—'}</td><td title={new Date(o.last_seen).toLocaleString(lang)}>{ago(o.last_seen)}</td></tr>)}</tbody>
            </table></div>
          )}
        </>)}
      </div>

      <div className="fx-grid2" style={{ marginTop: 16 }}>
        <div className="fx-card ad-card">
          <h3><span className="pco-mic ad-h3ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" /></svg></span>{L('Aviso para todos')}</h3>
          <textarea className="fx-input" rows={3} maxLength={500} value={ann.message} placeholder={L('Ex.: Nova versão disponível com muitas melhorias!')} onChange={(e) => setAnn({ ...ann, message: e.target.value })} />
          <div className="fx-inline" style={{ marginTop: 10, gap: 10 }}>
            <PickMenu label={L('Tipo')} value={ann.level} options={[{ value: 'info', label: L('Informação') }, { value: 'warn', label: L('Importante') }]} onChange={(v) => setAnn({ ...ann, level: String(v) })} />
            <label className="ad-fb-all"><input type="checkbox" checked={ann.active} onChange={(e) => setAnn({ ...ann, active: e.target.checked })} /> {L('Mostrar na app')}</label>
            <span style={{ flex: 1 }} />
            <button type="button" className="fx-btn primary" onClick={saveAnn}>{L('Guardar')}</button>
          </div>
          {annMsg && <p className="fx-muted fx-small">{annMsg}</p>}
        </div>
        <div className="fx-card ad-card">
          <h3><span className="pco-mic ad-h3ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></span>{L('Apagar conta')}</h3>
          <p className="fx-muted fx-small">{L('Apaga a conta e todos os dados dela no servidor. Os administradores não podem ser apagados.')}</p>
          <div className="fx-inline" style={{ gap: 10 }}>
            <input className="fx-input" type="email" value={del} placeholder="email" onChange={(e) => setDel(e.target.value)} />
            <button type="button" className="fx-btn danger" onClick={deleteUser}>{L('Apagar')}</button>
          </div>
          {delMsg && <p className="fx-muted fx-small">{delMsg}</p>}
        </div>
      </div>
    </>
  );
}

/** Caixa igual às do Resumo da app (ícone, título, número grande e linha de baixo).
 *  Com lista, abre por cima do conteúdo (sem mudar o tamanho da caixa) com cada item e a quantidade. */
function LiveBox({ icon, label, value, sub, list, live }: { icon: string; label: string; value?: number; sub?: string; list?: Record<string, number>; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const entries = Object.entries(list ?? {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const Tag = list ? 'button' : 'div';
  return (
    <div className={'ad-lbox' + (list ? ' click' : '') + (open ? ' open' : '')} ref={ref}>
      <Tag {...(list ? { type: 'button' as const, onClick: () => setOpen(!open), 'aria-expanded': open } : {})} className="ad-lbox-body">
        <span className="ad-lbox-head">
          <span className="pco-mic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg></span>
          <span className="ad-lbox-title">{label}</span>
          {live && <i className="ad-dot" />}
          {list && <svg className="ad-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>}
        </span>
        <b className="ad-lbox-value">{list ? entries.length : value ?? 0}</b>
        <small className="ad-lbox-sub">{list ? (entries[0] ? `${entries[0][0]} · ${Math.round((entries[0][1] / Math.max(1, total)) * 100)}%` : '—') : sub ?? '\u00a0'}</small>
      </Tag>
      {open && <div className="ad-lbox-pop">{entries.length === 0 ? <p className="fx-muted fx-small">—</p> : entries.map(([k, n]) => (
        <p key={k}><span>{k}</span><i><em style={{ width: `${(n / max) * 100}%` }} /></i><b>{n}</b></p>
      ))}</div>}
    </div>
  );
}
