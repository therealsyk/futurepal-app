// Presença: com sessão iniciada, a app diz ao Supabase "estou aqui" a cada minuto (plataforma, versão e página).
// Serve para o painel de Administração mostrar quem está a usar a app agora. Não envia dados financeiros.
// Precisa de supabase/admin_extra.sql; sem a tabela, os pedidos falham em silêncio.
import { useEffect, useState } from 'react';
import { getSupabase } from '../auth/supabase';
import { APP_VERSION } from './version';
import { currentPlatform } from './updates';

const EVERY_MS = 60_000;

export function usePresence(userId: string | undefined) {
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      const page = (window.location.hash.replace(/^#/, '').split('?')[0] || '/').slice(0, 60);
      // um registo por dia (para DAU/WAU/MAU e retenção); repetido no mesmo dia é ignorado
      const day = new Date().toLocaleDateString('sv-SE');
      try { if (localStorage.getItem('wallet.presenceDay') !== userId + day) { sb.from('presence_days').upsert({ user_id: userId, day, platform: currentPlatform() }, { onConflict: 'user_id,day', ignoreDuplicates: true }).then(({ error }) => { if (!error) localStorage.setItem('wallet.presenceDay', userId + day); }, () => {}); } } catch { /* sem storage */ }
      sb.from('presence').upsert({ user_id: userId, last_seen: new Date().toISOString(), platform: currentPlatform(), app_version: APP_VERSION, page }).then(() => {}, () => {});
    };
    beat();
    const id = setInterval(beat, EVERY_MS);
    const onVis = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('hashchange', beat);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('hashchange', beat); };
  }, [userId]);
}

/** Aviso do administrador para todos (tabela announcement). Fechar esconde só aquela versão do aviso. */
export function useAnnouncement(): { message: string; level: string; close: () => void } | null {
  const [a, setA] = useState<{ message: string; level: string; updated_at: string } | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from('announcement').select('message, level, active, updated_at').eq('id', 1).maybeSingle().then(({ data }) => {
      if (!data || !data.active || !data.message) return;
      try { if (localStorage.getItem('wallet.annClosed') === data.updated_at) return; } catch { /* sem storage */ }
      setA(data);
    }, () => {});
  }, []);
  if (!a) return null;
  return { message: a.message, level: a.level, close: () => { try { localStorage.setItem('wallet.annClosed', a.updated_at); } catch { /* sem storage */ } setA(null); } };
}
