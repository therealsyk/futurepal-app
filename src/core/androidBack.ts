// Botão "voltar" do Android: fecha a janela aberta; sem janelas, volta à página anterior; no Início, minimiza a app.
import { Capacitor } from '@capacitor/core';

const LAYERS = '.fx-backdrop, .bs-backdrop, .stm-backdrop, .pf-modal-back, .spi-back';

export function setupAndroidBack(): void {
  if (Capacitor.getPlatform() !== 'android') return;
  import('@capacitor/app').then(({ App }) => {
    App.addListener('backButton', () => {
      const top = [...document.querySelectorAll<HTMLElement>(LAYERS)].pop();
      if (top) {
        const back = top.querySelector<HTMLElement>('.spi-btn.no') ?? top.querySelector<HTMLElement>('.bs-back');
        if (back) back.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }
      const path = window.location.hash.replace(/^#/, '').split('?')[0] || '/';
      if (path !== '/' && window.history.length > 1) window.history.back();
      else if (path !== '/') window.location.hash = '#/';
      else App.minimizeApp().catch(() => {});
    }).catch(() => {});
  }, () => {});
}
