// Confirmação com o aspeto da app (em vez da janela cinzenta do sistema): caixa no meio do ecrã, fundo desfocado.
// Uso: if (!(await appConfirm('Apagar este movimento?'))) return;
import { L } from '../i18n/phrases';

export function appConfirm(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'spi-back';
    const danger = opts.danger !== false;
    const ic = danger ? 'M12 8v5M12 16h.01M12 3l9 16H3z' : 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z';
    back.className = 'spi-back cf-back';
    back.innerHTML = `<div class="spi-card cf-card ${danger ? 'danger' : 'ask'}" role="alertdialog" aria-modal="true">
      <span class="cf-ic"><i></i><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ic}"/></svg></span>
      <p class="spi-text cf-text"></p>
      <div class="spi-btns cf-btns"><button type="button" class="spi-btn no"></button><button type="button" class="spi-btn ${danger ? 'danger' : 'yes'}"></button></div>
    </div>`;
    // texto seguro (nunca HTML de fora); o que vem entre aspas fica em destaque
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    (back.querySelector('.cf-text') as HTMLElement).innerHTML = esc(message).replace(/"([^"]+)"/g, '<b class="cf-hl">$1</b>').replace(/«([^»]+)»/g, '<b class="cf-hl">$1</b>');
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
