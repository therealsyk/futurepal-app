// Interface simples (telemóvel): organização pensada para qualquer pessoa — Início, Metas, Limites, Contas.
// Ativa por omissão; ?ui=classic no endereço mostra a interface antiga (só para comparar/depurar).
export const SIMPLE_UI = typeof window === 'undefined' || new URLSearchParams(window.location.search).get('ui') !== 'classic';
if (SIMPLE_UI && typeof document !== 'undefined') document.documentElement.classList.add('ui-simple');

// PC com a interface da app de telemóvel.
// Ativa por omissão em ecrãs largos (PC); ?pc=classic mostra a interface antiga do PC.
export const PC_MOBILE = typeof window !== 'undefined' && window.innerWidth > 768 && new URLSearchParams(window.location.search).get('pc') !== 'classic';
if (PC_MOBILE && typeof document !== 'undefined') document.documentElement.classList.add('pcm');


// A janela passou de larga a estreita (ou o contrário): a interface escolhe-se ao abrir, por isso volta a abrir no modo certo
// (senão aparecia o painel antigo). Com uma janela aberta, espera que se feche para não perder o que se escreveu.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && SIMPLE_UI && new URLSearchParams(window.location.search).get('pc') !== 'classic') {
  let timer: ReturnType<typeof setInterval> | undefined;
  const wrong = () => window.innerWidth > 768 !== PC_MOBILE;
  const check = () => {
    if (!wrong()) { clearInterval(timer); timer = undefined; return; }
    if (!document.querySelector('[role="dialog"]')) window.location.reload();
  };
  window.matchMedia('(max-width: 768px)').addEventListener('change', () => { if (!timer) timer = setInterval(check, 400); });
}
