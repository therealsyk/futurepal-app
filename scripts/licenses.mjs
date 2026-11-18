// Gera public/THIRD_PARTY_NOTICES.txt com a licença de cada biblioteca que vai dentro da app
// (dependências de produção, incluindo as indiretas). Corre em cada build (ver package.json).
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let paths = [];
try {
  paths = execSync(`${npm} ls --omit=dev --all --parseable`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true })
    .split(/\r?\n/).filter((p) => p && p !== root && p.includes('node_modules'));
} catch (err) {
  // npm ls devolve código ≠ 0 com avisos de peer deps; o stdout continua válido
  paths = String(err.stdout || '').split(/\r?\n/).filter((p) => p && p.includes('node_modules'));
}
const seen = new Map();
for (const dir of paths) {
  const pkgFile = join(dir, 'package.json');
  if (!existsSync(pkgFile)) continue;
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const id = `${pkg.name}@${pkg.version}`;
  if (seen.has(id)) continue;
  const licFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(f));
  const text = licFile ? readFileSync(join(dir, licFile), 'utf8').trim() : '';
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'see package';
  seen.set(id, { name: pkg.name, version: pkg.version, license, text });
}
const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const out = [
  'Plannest — avisos de software de terceiros / third-party software notices',
  `Gerado em ${new Date().toISOString().slice(0, 10)} · ${list.length} bibliotecas`,
  '',
  ...list.map((p) => `${'='.repeat(78)}\n${p.name} ${p.version} — ${p.license}\n${'='.repeat(78)}\n${p.text || '(sem ficheiro de licença no pacote; licença: ' + p.license + ')'}\n`),
].join('\n');
writeFileSync(join(root, 'public', 'THIRD_PARTY_NOTICES.txt'), out);
const counts = {};
for (const p of list) counts[p.license] = (counts[p.license] ?? 0) + 1;
console.log(`THIRD_PARTY_NOTICES.txt: ${list.length} bibliotecas`, counts);
