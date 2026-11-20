// Interface simples (telemóvel): organização pensada para qualquer pessoa — Início, Metas, Limites, Contas.
// Ativa por omissão; ?ui=classic no endereço mostra a interface antiga (só para comparar/depurar).
export const SIMPLE_UI = typeof window === 'undefined' || new URLSearchParams(window.location.search).get('ui') !== 'classic';
if (SIMPLE_UI && typeof document !== 'undefined') document.documentElement.classList.add('ui-simple');

// PC com a interface da app de telemóvel (pré-visualização): abrir com ?pc=mobile.
export const PC_MOBILE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pc') === 'mobile';
if (PC_MOBILE && typeof document !== 'undefined') document.documentElement.classList.add('pcm');

