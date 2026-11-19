// Sincronização automática e entre aparelhos.
//  • Uma sincronização de cada vez (pedidos a meio juntam-se numa só a seguir).
//  • Automática: de minuto a minuto com a app aberta e sempre que se volta à app.
//  • Entre aparelhos: depois de enviar alterações (ou ao carregar em "Sincronizar agora"), avisa os outros
//    aparelhos da mesma conta por Supabase Realtime (broadcast); quem estiver aberto sincroniza logo.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db/app-db';
import { runSync } from './runSync';
import { syncSalaryTransactions } from '../core/salaryTx';
import type { AppSettings } from '../core/settings';

export const AUTO_SYNC_MS = 60_000;
export const SYNC_DONE_EVENT = 'wallet:sync-done';
export interface SyncDone { pushed: number; pulled: number; error?: string; settings: AppSettings | null }

let running: Promise<SyncDone> | null = null;
let queued = false;
let channel: RealtimeChannel | null = null;

/** Sincroniza agora. notifyOthers: avisa os outros aparelhos mesmo que nada tenha sido enviado (botão manual). */
export function syncAll(sb: SupabaseClient, uid: string, opts: { notifyOthers?: boolean } = {}): Promise<SyncDone> {
  if (running) { queued = true; return running; }
  running = (async () => {
    const r = await runSync(sb, db, uid);
    await syncSalaryTransactions(db).catch(() => {}); // salários vindos de outro aparelho
    const done: SyncDone = { pushed: r.pushed, pulled: r.pulled, error: r.error, settings: r.settings };
    if (!r.error && (r.pushed > 0 || opts.notifyOthers)) notifyOthers();
    window.dispatchEvent(new CustomEvent<SyncDone>(SYNC_DONE_EVENT, { detail: done }));
    return done;
  })().finally(() => {
    running = null;
    if (queued) { queued = false; void syncAll(sb, uid); }
  });
  return running;
}

function notifyOthers() {
  channel?.send({ type: 'broadcast', event: 'changed', payload: {} }).catch(() => {});
}

/** Liga a sincronização automática para esta conta. Devolve a função para desligar (sair da conta, trocar). */
export function startAutoSync(sb: SupabaseClient, uid: string, canSync: () => boolean): () => void {
  let last = 0;
  const go = (minGap = 0) => {
    if (!canSync() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    if (Date.now() - last < minGap) return;
    last = Date.now();
    void syncAll(sb, uid).catch(() => {});
  };
  const timer = setInterval(() => { if (document.visibilityState === 'visible') go(); }, AUTO_SYNC_MS);
  const onVisible = () => { if (document.visibilityState === 'visible') go(15_000); };
  const onOnline = () => go();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onOnline);

  // Outro aparelho da mesma conta enviou alterações: sincroniza (um pouco depois, para o envio ter terminado)
  let pending: ReturnType<typeof setTimeout> | null = null;
  channel = sb.channel(`fp-sync-${uid}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => go(), 1500);
  }).subscribe();

  return () => {
    clearInterval(timer);
    if (pending) clearTimeout(pending);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.removeEventListener('online', onOnline);
    if (channel) { sb.removeChannel(channel).catch(() => {}); channel = null; }
  };
}
