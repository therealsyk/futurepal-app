// Os números só "rolam" logo a seguir a mudar o período (Mensal/Anual, mês, filtro de datas).
// Ao abrir uma página ou quando os dados mudam, aparecem já com o valor certo.
let last = 0;
export const markPeriodChange = () => { last = performance.now(); };
export const resetRoll = () => { last = 0; };
export const shouldRoll = () => performance.now() - last < 1500;
