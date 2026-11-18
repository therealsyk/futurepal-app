// Muda a versão da app em TODOS os sítios de uma vez:
//   package.json (Windows e código) · android/app/build.gradle · ios (MARKETING_VERSION / build)
// Uso:  node scripts/set-version.mjs 1.2.0      ou   node scripts/set-version.mjs patch|minor|major
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const arg = process.argv[2];
const cur = parse(pkg.version) ?? [0, 0, 0];
let next;
if (arg === 'patch') next = [cur[0], cur[1], cur[2] + 1];
else if (arg === 'minor') next = [cur[0], cur[1] + 1, 0];
else if (arg === 'major') next = [cur[0] + 1, 0, 0];
else next = parse(arg);

if (!next) {
  console.error('Uso: node scripts/set-version.mjs <x.y.z | patch | minor | major>');
  process.exit(1);
}
const version = next.join('.');
const code = next[0] * 10000 + next[1] * 100 + next[2];
if (code <= cur[0] * 10000 + cur[1] * 100 + cur[2] && arg !== pkg.version) {
  console.error(`A versão nova (${version}) tem de ser maior do que a atual (${pkg.version}). As lojas recusam versões iguais ou mais baixas.`);
  process.exit(1);
}

pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json        -> ${version}`);

const gradle = join(root, 'android', 'app', 'build.gradle');
if (existsSync(gradle)) {
  let s = readFileSync(gradle, 'utf8');
  s = s.replace(/versionCode\s+\d+/, `versionCode ${code}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  writeFileSync(gradle, s);
  console.log(`Android             -> versionName ${version}, versionCode ${code}`);
}

const pbx = join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
if (existsSync(pbx)) {
  let s = readFileSync(pbx, 'utf8');
  s = s.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
       .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${code};`);
  writeFileSync(pbx, s);
  console.log(`iOS                 -> ${version} (build ${code})`);
}
