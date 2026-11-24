// Limpa as versões antigas em app/release/ NESTE computador (o GitHub fica com todas).
// Fica com as 2 versões mais recentes: a atual e a anterior (para o caso de a nova ter problemas).
//   node scripts/clean-releases.mjs [quantas=2]
// Corre sozinho no fim do scripts/release.mjs.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const release = join(dirname(fileURLToPath(import.meta.url)), '..', 'release');
const keepCount = Math.max(1, Number(process.argv[2]) || 2);
if (!existsSync(release)) process.exit(0);

const VER = /^\d+\.\d+\.\d+$/;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const versions = readdirSync(release).filter((n) => VER.test(n) && statSync(join(release, n)).isDirectory()).sort(cmp);
if (versions.length === 0) process.exit(0);
const keep = versions.slice(-keepCount);
const oldest = keep[0];

let freed = 0;
const size = (p) => { const s = statSync(p); return s.isDirectory() ? readdirSync(p).reduce((t, n) => t + size(join(p, n)), 0) : s.size; };
const remove = (p) => { try { freed += size(p); rmSync(p, { recursive: true, force: true }); console.log('  apagado: ' + p.slice(release.length + 1)); } catch (e) { console.log('  [!] não deu para apagar (está aberto?): ' + p.slice(release.length + 1)); } };

// 1. pastas de versões antigas (release/x.y.z)
for (const v of versions) if (!keep.includes(v)) remove(join(release, v));
// 2. APKs antigos (release/android/FuturePal-x.y.z.apk)
const android = join(release, 'android');
if (existsSync(android)) for (const n of readdirSync(android)) {
  const m = n.match(/(\d+\.\d+\.\d+)\.apk$/);
  if (m && cmp(m[1], oldest) < 0) remove(join(android, n));
}
// 3. restos de compilações antigas soltos na raiz de release/ (antes de cada versão ter a sua pasta)
for (const n of readdirSync(release)) {
  const p = join(release, n);
  if (/^(Wallet|FuturePal|MyFuturePal|Plannest)[- ].*\.(exe|blockmap)$/i.test(n) || /^(win-unpacked|asar_check\d*|builder-debug\.yml|builder-effective-config\.yaml|latest\.yml)$/i.test(n)) remove(p);
}
console.log(`Limpeza: ficam ${keep.join(' e ')} · libertados ${(freed / 1048576).toFixed(0)} MB`);
