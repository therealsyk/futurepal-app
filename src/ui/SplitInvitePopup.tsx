// Convite para dividir despesas: aparece numa janela ao abrir a app, com quem convidou, o grupo e Aceitar / Rejeitar.
import { SPLIT_CHANGED } from '../core/groupLink';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { L } from '../i18n/phrases';

type Inv = { id: string; group_id: string; group_name: string; invited_by_name: string };

export function SplitInvitePopup() {
  const auth = useAuth();
  const [list, setList] = useState<Inv[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !auth.user) { setList([]); return; }
    sb.rpc('my_split_invites').then(({ data }) => {
      let seen: string[] = [];
      try { seen = JSON.parse(sessionStorage.getItem('wallet.invSeen') || '[]'); } catch { /* sem storage */ }
      setList(((data ?? []) as Inv[]).filter((i) => !seen.includes(i.id)));
    }, () => {});
  }, [auth.user]);
  const inv = list[0];
  if (!inv) return null;
  const meta = (auth.user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  const myName = meta.full_name || meta.name || (auth.user?.email ?? '').split('@')[0];
  const answer = async (accept: boolean | null) => {
    if (accept !== null) {
      setBusy(true);
      await getSupabase()?.rpc('answer_split_invite', { p_invite: inv.id, p_accept: accept, p_display_name: myName });
      setBusy(false);
      window.dispatchEvent(new Event(SPLIT_CHANGED));
      if (accept) window.location.hash = '#/grupos';
    } else {
      try { const seen = JSON.parse(sessionStorage.getItem('wallet.invSeen') || '[]'); sessionStorage.setItem('wallet.invSeen', JSON.stringify([...seen, inv.id])); } catch { /* */ }
    }
    setList(list.slice(1));
  };
  const initial = (inv.invited_by_name || '?').trim().charAt(0).toUpperCase();
  return createPortal(
    <div className="spi-back" onMouseDown={(e) => { if (e.target === e.currentTarget) answer(null); }}>
      <div className="spi-card" role="dialog" aria-modal="true">
        <span className="spi-face">{initial}</span>
        <p className="spi-text"><b>{inv.invited_by_name}</b> {L('convidou-te para dividir as despesas de')} <b>{inv.group_name}</b>.</p>
        <div className="spi-btns">
          <button type="button" className="spi-btn no" disabled={busy} onClick={() => answer(false)}>{L('Rejeitar')}</button>
          <button type="button" className="spi-btn yes" disabled={busy} onClick={() => answer(true)}>{L('Aceitar')}</button>
        </div>
        <button type="button" className="spi-later" onClick={() => answer(null)}>{L('Decidir mais tarde')}</button>
      </div>
    </div>,
    document.body,
  );
}
