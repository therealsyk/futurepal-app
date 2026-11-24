import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { L } from '../i18n/phrases';
import logoUrl from '../assets/logo.svg';

// No fim do setup (acabou a visita ou saltou-a): uma pausa curta a dar as boas-vindas, com o logótipo e o fundo desfocado.
// Aparece só uma vez por aparelho.
const KEY = 'wallet.welcomed', EVT = 'wallet:welcome';
export function showWelcome(): void {
  try { if (localStorage.getItem(KEY) === '1') return; localStorage.setItem(KEY, '1'); } catch { /* sem storage */ }
  window.dispatchEvent(new Event(EVT));
}

export function WelcomeSplash() {
  const [on, setOn] = useState<'in' | 'out' | null>(null);
  useEffect(() => {
    let t1 = 0, t2 = 0;
    const go = () => { setOn('in'); t1 = window.setTimeout(() => setOn('out'), 2600); t2 = window.setTimeout(() => setOn(null), 3100); };
    window.addEventListener(EVT, go);
    return () => { window.removeEventListener(EVT, go); clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (!on) return null;
  return createPortal(
    <div className={'wsp ' + on} role="status" onClick={() => setOn('out')}>
      <div className="wsp-card">
        <span className="wsp-logo"><i /><i /><img src={logoUrl} alt="" /></span>
        <h2>{L('Bem-vindo ao MyFuturePal')}</h2>
        <p>{L('Está tudo pronto. Vamos pôr o teu dinheiro a render!')}</p>
        <span className="wsp-bar"><i /></span>
      </div>
    </div>, document.body);
}
