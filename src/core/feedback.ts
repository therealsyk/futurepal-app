// Enviar feedback / reportar erros para a tabela public.feedback (supabase/feedback.sql).
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_VERSION } from './version';

export type FeedbackKind = 'idea' | 'bug' | 'other';

/** Em que aparelho corre a app (ajuda a perceber os erros). */
export function platformName(): string {
  const w = typeof window !== 'undefined' ? (window as unknown as { __electronBridge?: unknown; Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }) : null;
  if (!w) return 'unknown';
  if (w.__electronBridge) return 'windows';
  if (w.Capacitor?.isNativePlatform?.()) return w.Capacitor.getPlatform?.() ?? 'mobile';
  return 'web';
}

/** Valida e envia. Devolve uma chave de erro (i18n) ou null se correu bem. */
export async function sendFeedback(
  sb: SupabaseClient | null,
  input: { kind: FeedbackKind; message: string; email?: string; language: string },
): Promise<null | 'feedback.errShort' | 'feedback.errEmail' | 'feedback.errOffline' | 'feedback.errSend'> {
  const message = input.message.trim();
  if (message.length < 3) return 'feedback.errShort';
  const email = (input.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'feedback.errEmail';
  if (!sb) return 'feedback.errOffline';
  const { error } = await sb.from('feedback').insert({
    kind: input.kind,
    message: message.slice(0, 4000),
    email: email || null,
    app_version: APP_VERSION,
    platform: platformName(),
    language: input.language.slice(0, 10),
  });
  return error ? 'feedback.errSend' : null;
}
