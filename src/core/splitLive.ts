// Grupos partilhados em direto: quem muda alguma coisa avisa os outros aparelhos (aviso vazio, sem dados) e eles voltam a ler.
// Se o aviso falhar, ao voltar à app e de tempos a tempos a página lê na mesma.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '../auth/supabase';
import { SPLIT_CHANGED } from './groupLink';

const open = new Map<string, RealtimeChannel>();
const changed = () => { window.dispatchEvent(new Event(SPLIT_CHANGED)); };
const EVERY_MS = 45_000;

/** Enquanto a página está aberta: ouve os grupos e volta a ler quando mudam. */
export function listenSplit(ids: string[]): () => void {
  const sb = getSupabase();
  if (!sb || ids.length === 0) return () => {};
  const mine = ids.slice(0, 30).filter((id) => !open.has(id));
  let wait: ReturnType<typeof setTimeout> | null = null;
  for (const id of mine) {
    const ch = sb.channel(`fp-split-${id}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'changed' }, () => { if (wait) clearTimeout(wait); wait = setTimeout(changed, 400); }).subscribe();
    open.set(id, ch);
  }
  const onVisible = () => { if (document.visibilityState === 'visible') changed(); };
  const timer = setInterval(onVisible, EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    if (wait) clearTimeout(wait);
    document.removeEventListener('visibilitychange', onVisible);
    for (const id of mine) { const ch = open.get(id); open.delete(id); if (ch) sb.removeChannel(ch).catch(() => {}); }
  };
}

/** Avisa as outras pessoas do grupo de que algo mudou. */
export function tellSplit(id: string): void {
  const sb = getSupabase();
  if (!sb) return;
  const have = open.get(id), ch = have ?? sb.channel(`fp-split-${id}`);
  Promise.resolve(ch.send({ type: 'broadcast', event: 'changed', payload: {} })).catch(() => {}).finally(() => { if (!have) sb.removeChannel(ch).catch(() => {}); });
}
