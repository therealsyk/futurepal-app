import { useEffect, useState } from 'react';

// true em ecrãs estreitos (telemóvel). Mesmo limite que o mobile.css (768px).
const QUERY = '(max-width: 768px)';

export function useIsMobile(): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
