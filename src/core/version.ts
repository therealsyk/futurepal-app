// Versões no formato "1.2.3" (major.minor.patch). A versão da app vem do package.json
// (injetada no build pelo vite.config.mts como __APP_VERSION__).

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/** "v1.2" -> [1, 2, 0]; partes inválidas contam como 0. */
export function parseVersion(v: string): [number, number, number] {
  const parts = String(v ?? '').trim().replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((p) => parseInt(p, 10));
  const n = (i: number) => (Number.isFinite(parts[i]) && parts[i] >= 0 ? parts[i] : 0);
  return [n(0), n(1), n(2)];
}

/** -1 se a < b, 0 se iguais, 1 se a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Número inteiro e sempre crescente para o Android (versionCode) e iOS (build): 1.2.3 -> 10203. */
export function versionCode(v: string): number {
  const [a, b, c] = parseVersion(v);
  return a * 10000 + b * 100 + c;
}
