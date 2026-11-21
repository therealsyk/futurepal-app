// Confirmação com o aspeto da app (em vez da janela cinzenta do sistema): caixa no meio do ecrã, fundo desfocado.
// Uso: if (!(await appConfirm('Apagar este movimento?'))) return;
import { L } from '../i18n/phrases';

export function appConfirm(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'spi-back';
    back.innerHTML = `<div class="spi-card" role="alertdialog" aria-modal="true">
      <span class="spi-face ${opts.danger !== false ? 'warn' : ''}">${opts.danger !== false ? '!' : '?'}</span>
      <p class="spi-text"></p>
      <div class="spi-btns"><button type="button" class="spi-btn no"></button><button type="button" class="spi-btn ${opts.danger !== false ? 'danger' : 'yes'}"></button></div>
    </div>`;
    (back.querySelector('.spi-text') as HTMLElement).innerText = message; // texto, nunca HTML
    const [no, yes] = Array.from(back.querySelectorAll('button'));
    no.textContent = L('Cancelar');
    yes.textContent = opts.ok ?? L('Confirmar');
    const done = (v: boolean) => { document.removeEventListener('keydown', onKey); back.remove(); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    back.onmousedown = (e) => { if (e.target === back) done(false); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    yes.focus();
  });
}
