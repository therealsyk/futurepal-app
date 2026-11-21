// Administração (extra): quem está a usar a app agora, aviso para todos e apagar contas.
// Precisa de supabase/admin_extra.sql.
import { useEffect, useState } from 'react';
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
        <h3><i className="ad-dot" />{L('Online agora')} <span className="ad-fb-count">{online.length}</span></h3>
        {err ? <p className="fx-muted">{err}</p> : (<>
          {ps && <div className="ad-lboxes">
            <LiveBox label={L('Agora')} value={ps.now} />
            <LiveBox label={L('Hoje')} value={ps.today} />
            <LiveBox label={L('Últimos 7 dias')} value={ps.week} />
            <LiveBox label={L('Plataformas')} list={ps.platforms} />
            <LiveBox label={L('Versões')} list={ps.versions} />
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
          <h3>{L('Aviso para todos')}</h3>
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
          <h3>{L('Apagar conta')}</h3>
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

/** Caixa de número; com lista, mostra o total e abre para baixo com cada item e a quantidade. */
function LiveBox({ label, value, list }: { label: string; value?: number; list?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(list ?? {}).sort((a, b) => b[1] - a[1]);
  const total = list ? entries.reduce((a, [, n]) => a + n, 0) : value ?? 0;
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (!list) return <div className="ad-lbox"><small>{label}</small><b>{total}</b></div>;
  return (
    <div className={'ad-lbox click' + (open ? ' open' : '')}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <small>{label}</small><b>{entries.length}</b>
        <em>{entries[0] ? `${entries[0][0]} · ${Math.round((entries[0][1] / Math.max(1, total)) * 100)}%` : '—'}</em>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <div className="ad-lbox-list">{entries.length === 0 ? <p className="fx-muted fx-small">—</p> : entries.map(([k, n]) => (
        <p key={k}><span>{k}</span><i><em style={{ width: `${(n / max) * 100}%` }} /></i><b>{n}</b></p>
      ))}</div>}
    </div>
  );
}
