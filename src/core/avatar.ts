// Foto de perfil.
//  • Com sessão: a foto vai para o Supabase Storage (bucket "avatars", ver supabase/avatars.sql) e o link fica em
//    user_metadata.avatar_custom, por isso aparece em todos os aparelhos.
//  • Sem conta: fica só neste aparelho (localStorage).
//  • Sem foto própria: usa a do Google/Facebook/Apple, se houver; se essa não carregar, mostram-se as iniciais.
import type { SupabaseClient, User } from '@supabase/supabase-js';

const LOCAL_KEY = 'wallet.avatar';
export const AVATAR_EVENT = 'wallet:avatar';

export function localAvatar(): string | null {
  try { return localStorage.getItem(LOCAL_KEY); } catch { return null; }
}

function setLocalAvatar(dataUrl: string | null) {
  try { if (dataUrl) localStorage.setItem(LOCAL_KEY, dataUrl); else localStorage.removeItem(LOCAL_KEY); } catch { /* sem storage */ }
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT));
}

/** A foto a mostrar para esta pessoa (ou null = iniciais). */
export function avatarUrl(user: User | null | undefined): string | null {
  const meta = (user?.user_metadata ?? {}) as { avatar_custom?: string | null; avatar_url?: string; picture?: string };
  if (user && meta.avatar_custom) return meta.avatar_custom;
  if (!user) return localAvatar();
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

/** Guarda a nova foto. Devolve 'cloud' (todos os aparelhos) ou 'local' (só este). */
export async function saveAvatar(file: Blob, sb: SupabaseClient | null, user: User | null | undefined): Promise<'cloud' | 'local'> {
  const img = await squareImage(file);
  if (!sb || !user) { setLocalAvatar(await toDataUrl(img)); return 'local'; }
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
  return 'cloud';
}

/** Remove a foto própria (volta à do Google, se houver, ou às iniciais). */
export async function removeAvatar(sb: SupabaseClient | null, user: User | null | undefined): Promise<void> {
  if (!sb || !user) { setLocalAvatar(null); return; }
  const { error } = await sb.auth.updateUser({ data: { avatar_custom: null } });
  if (error) throw error;
  const list = await sb.storage.from('avatars').list(user.id).catch(() => null);
  const old = (list?.data ?? []).map((f) => `${user.id}/${f.name}`);
  if (old.length) await sb.storage.from('avatars').remove(old).catch(() => {});
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT));
}
