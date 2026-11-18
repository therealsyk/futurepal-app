// Foto de perfil.
//  • Com sessão: a foto vai para o Supabase Storage (bucket "avatars", ver supabase/avatars.sql) e o link fica em
//    user_metadata.avatar_custom, por isso aparece em todos os aparelhos.
//  • Só existe com conta. No registo pode escolher-se uma foto antes de haver sessão (ex.: falta confirmar o email):
//    fica "pendente" neste aparelho e é enviada no primeiro login (applyPendingAvatar).
//  • Sem foto própria: usa a do Google/Facebook/Apple, se houver; se essa não carregar, mostram-se as iniciais.
import type { SupabaseClient, User } from '@supabase/supabase-js';

const PENDING_KEY = 'wallet.avatar.pending';
export const AVATAR_EVENT = 'wallet:avatar';

/** A foto a mostrar para esta pessoa (ou null = iniciais). */
export function avatarUrl(user: User | null | undefined): string | null {
  const meta = (user?.user_metadata ?? {}) as { avatar_custom?: string | null; avatar_url?: string; picture?: string };
  if (!user) return null;
  if (meta.avatar_custom) return meta.avatar_custom;
  return meta.avatar_url || meta.picture || null;
}

/** Recorta ao centro em quadrado e reduz (fica com poucos KB). */
export async function squareImage(file: Blob, size = 256, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = Math.min(size, side);
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('image'))), 'image/jpeg', quality));
}

const toDataUrl = (b: Blob) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = ko; r.readAsDataURL(b); });

/** Foto escolhida no registo, à espera de sessão. */
export async function setPendingAvatar(file: Blob | null): Promise<string | null> {
  const url = file ? await toDataUrl(await squareImage(file)) : null;
  try { if (url) localStorage.setItem(PENDING_KEY, url); else localStorage.removeItem(PENDING_KEY); } catch { /* sem storage */ }
  return url;
}

/** No primeiro login depois do registo: envia a foto pendente (se a pessoa ainda não tiver uma). */
export async function applyPendingAvatar(sb: SupabaseClient | null, user: User | null | undefined): Promise<void> {
  let url: string | null = null;
  try { url = localStorage.getItem(PENDING_KEY); } catch { return; }
  if (!url || !sb || !user) return;
  const meta = (user.user_metadata ?? {}) as { avatar_custom?: string | null };
  if (!meta.avatar_custom) await saveAvatar(await (await fetch(url)).blob(), sb, user);
  try { localStorage.removeItem(PENDING_KEY); } catch { /* sem storage */ }
}

/** Guarda a nova foto (precisa de sessão). */
export async function saveAvatar(file: Blob, sb: SupabaseClient | null, user: User | null | undefined): Promise<void> {
  if (!sb || !user) throw new Error('no session');
  const img = await squareImage(file);
  const path = `${user.id}/avatar-${Date.now()}.jpg`; // nome novo a cada troca: evita a cache mostrar a antiga
  const up = await sb.storage.from('avatars').upload(path, img, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw up.error;
  const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  const { error } = await sb.auth.updateUser({ data: { avatar_custom: url } });
  if (error) throw error;
  // apaga as fotos antigas desta pessoa (não é grave se falhar)
  const list = await sb.storage.from('avatars').list(user.id).catch(() => null);
  const old = (list?.data ?? []).map((f) => `${user.id}/${f.name}`).filter((p) => p !== path);
  if (old.length) await sb.storage.from('avatars').remove(old).catch(() => {});
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT));
}

/** Remove a foto própria (volta à do Google, se houver, ou às iniciais). */
export async function removeAvatar(sb: SupabaseClient | null, user: User | null | undefined): Promise<void> {
  if (!sb || !user) return;
  const { error } = await sb.auth.updateUser({ data: { avatar_custom: null } });
  if (error) throw error;
  const list = await sb.storage.from('avatars').list(user.id).catch(() => null);
  const old = (list?.data ?? []).map((f) => `${user.id}/${f.name}`);
  if (old.length) await sb.storage.from('avatars').remove(old).catch(() => {});
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT));
}
