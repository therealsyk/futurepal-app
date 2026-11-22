// Janelas sem scroll: se o conteúdo não couber no ecrã, fica um pouco mais pequeno até caber (nunca menos de 78%).
import { useLayoutEffect, type RefObject } from 'react';

const MIN = 0.78;

export function useFitSheet(body: RefObject<HTMLElement | null>, on = true): void {
  useLayoutEffect(() => {
    const el = body.current, sheet = el?.parentElement;
    if (!on || !el || !sheet) return;
    const fit = () => {
      el.style.zoom = '';
      const cs = getComputedStyle(sheet), max = parseFloat(cs.maxHeight);
      const others = [...sheet.children].reduce((h, c) => (c === el || getComputedStyle(c).position === 'absolute' ? h : h + (c as HTMLElement).offsetHeight + parseFloat(getComputedStyle(c).marginTop) + parseFloat(getComputedStyle(c).marginBottom)), 0);
      const room = (Number.isFinite(max) ? max : window.innerHeight - 20) - others - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4;
      if (el.scrollHeight <= room + 1) return;
      let k = Math.max(MIN, room / el.scrollHeight);
      el.style.zoom = String(k);
      // com o zoom o texto volta a partir-se: mais um acerto, se ainda sobrar
      if (k > MIN && el.scrollHeight * k > room + 1) { k = Math.max(MIN, k * (room / (el.scrollHeight * k))); el.style.zoom = String(k); }
    };
    fit();
    const mo = new MutationObserver(fit);
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener('resize', fit);
    return () => { mo.disconnect(); window.removeEventListener('resize', fit); };
  }, [body, on]);
}
