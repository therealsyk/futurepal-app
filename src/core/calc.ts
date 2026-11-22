// Conta simples da calculadora: + − × ÷ com prioridades e %. Devolve null se a conta estiver incompleta ou for impossível.
export const OPS = '+-*/';

export function evalCalc(expr: string): number | null {
  const tk = expr.replace(/[+\-*/]+$/, '').match(/\d+\.?\d*%?|\.\d+%?|[+\-*/]/g) ?? [];
  let i = 0;
  const num = (): { v: number; pct: boolean } | null => {
    let neg = false;
    while (tk[i] === '-') { neg = !neg; i++; }
    const s = tk[i];
    if (s === undefined || OPS.includes(s)) return null;
    i++;
    const pct = s.endsWith('%');
    const n = Number(pct ? s.slice(0, -1) : s) * (neg ? -1 : 1);
    return { v: pct ? n / 100 : n, pct };
  };
  const term = () => {
    const a = num();
    if (!a) return null;
    let { v, pct } = a;
    while (tk[i] === '*' || tk[i] === '/') {
      const op = tk[i++], b = num();
      if (!b) return null;
      v = op === '*' ? v * b.v : v / b.v;
      pct = false;
    }
    return { v, pct };
  };
  const first = term();
  if (!first) return null;
  let total = first.v;
  while (i < tk.length) {
    const op = tk[i++], b = term();
    if (!b || (op !== '+' && op !== '-')) return null;
    const x = b.pct ? total * b.v : b.v; // "200 - 10%" = 180
    total = op === '+' ? total + x : total - x;
  }
  if (!Number.isFinite(total)) return null;
  return Math.round(total * 1e8) / 1e8; // sem 0,30000000000000004
}

/** Acrescenta uma tecla à conta, sem deixar escrever coisas sem sentido (dois operadores, duas vírgulas, …). */
export function pressCalc(expr: string, key: string): string {
  const last = expr.slice(-1);
  if (OPS.includes(key)) {
    if (!expr) return key === '-' ? '-' : '';
    if (expr === '-') return expr;
    return (OPS.includes(last) ? expr.slice(0, -1) : expr) + key;
  }
  if (key === '%') return /[\d.]$/.test(expr) ? expr + '%' : expr;
  if (last === '%') return expr; // depois de % só um operador
  const cur = /[\d.]*$/.exec(expr)![0];
  if (key === '.') return cur.includes('.') ? expr : expr + (cur ? '.' : '0.');
  if (cur === '0') return expr.slice(0, -1) + key;
  return cur.replace('.', '').length >= 12 ? expr : expr + key;
}
