import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { AVATAR_EVENT, avatarUrl } from '../core/avatar';

/** Foto de perfil redonda; se não houver ou não carregar (ex.: foto do Google bloqueada), mostra as iniciais. */
export function UserAvatar({ user, name, className = 'ab-initials', size }: { user: User | null | undefined; name: string; className?: string; size?: number }) {
  const [, bump] = useState(0);
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(AVATAR_EVENT, on);
    return () => window.removeEventListener(AVATAR_EVENT, on);
  }, []);
  const src = avatarUrl(user);
  const style = size ? { width: size, height: size } : undefined;
  if (src && broken !== src) {
    return <img src={src} alt="" referrerPolicy="no-referrer" style={style} onError={() => setBroken(src)} />;
  }
  return <span className={className} style={style}>{(name || '?').slice(0, 2).toUpperCase()}</span>;
}
