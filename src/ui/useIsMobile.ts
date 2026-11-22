import { useEffect, useState } from 'react';
import { PC_MOBILE, SIMPLE_UI } from '../core/uiMode';

// true em ecrãs estreitos (telemóvel). Mesmo limite que o mobile.css (768px).
const QUERY = '(max-width: 768px)';
// A interface atual é a mesma no PC e no telemóvel: o formulário antigo só existe com ?pc=classic ou ?ui=classic.
// (Antes, alargar a janela com um formulário aberto trocava-o pelo antigo.)
const ALWAYS = PC_MOBILE || (SIMPLE_UI && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pc') !== 'classic');

export function useIsMobile(): boolean {
  const get = () => ALWAYS || typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const on = () => setMobile(ALWAYS || mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
