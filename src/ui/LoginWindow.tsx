// Entrar / criar conta numa janela a flutuar, por cima de qualquer página (fundo desfocado).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth/AuthContext';
import { loadSettings, saveSettings } from '../core/settings';
import { L } from '../i18n/phrases';
import { LoginForm } from '../pages/Login';
import { Ic, ICON } from './fx';

type Mode = 'signin' | 'signup';
const EVENT = 'wallet:login';
export const openLogin = (mode: Mode = 'signin'): void => { window.dispatchEvent(new CustomEvent(EVENT, { detail: mode })); };

export function LoginWindow() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode | null>(null);
  useEffect(() => { const on = (e: Event) => setMode((e as CustomEvent<Mode>).detail); window.addEventListener(EVENT, on); return () => window.removeEventListener(EVENT, on); }, []);
  useEffect(() => { if (auth.user) setMode(null); }, [auth.user]); // Google/Facebook/Apple: a sessão chega por fora
  useEffect(() => {
    if (!mode) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMode(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mode]);
  if (!mode) return null;
  return createPortal(
    <div className="spi-back lg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setMode(null); }}>
      <div className="lg-win" role="dialog" aria-modal="true" aria-label={L('Iniciar sessão')}>
        <button type="button" className="tipb-x lg-x" onClick={() => setMode(null)} aria-label={L('Fechar')}><Ic d={ICON.close} size={18} /></button>
        <LoginForm initialMode={mode} onDone={() => { saveSettings({ ...loadSettings(), account: 'signedin' }); setMode(null); }} />
      </div>
    </div>, document.body);
}
