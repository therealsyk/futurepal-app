// Lança uma versão nova da FuturePal.
//
//   node scripts/release.mjs <patch|minor|major|x.y.z> [--notes "O que mudou"] [--min x.y.z] [--skip-windows] [--skip-mobile]
//
// O que faz, por esta ordem:
//   1. muda a versão em todo o lado (package.json, Android, iOS)
//   2. corre os testes e compila (para em qualquer erro)
//   3. Windows: cria o instalador e, se houver GH_TOKEN, publica-o no GitHub Releases (é daí que as apps instaladas o vão buscar)
//   4. Android/iOS: copia a versão nova para os projetos nativos (depois compilas e envias para as lojas)
//   5. mostra o SQL a colar no Supabase para todas as apps verem o aviso "Há uma atualização"
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);
const bump = args[0];
if (!bump || bump.startsWith('--')) {
  console.error('Uso: node scripts/release.mjs <patch|minor|major|x.y.z> [--notes "texto"] [--min x.y.z] [--skip-windows] [--skip-mobile]');
  process.exit(1);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (cmd, env) => { console.log(`\n> ${cmd}`); execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }); };
const cfg = JSON.parse(readFileSync(join(root, 'release.config.json'), 'utf8'));
const owner = cfg.github?.owner?.trim();
const repo = cfg.github?.repo?.trim() || 'wallet-releases';

// 1. versão
run(`node scripts/set-version.mjs ${bump}`);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

// 2. testes + build web
run(`${npm} test`);
run(`${npm} run build`);

// 3. Windows
let windowsUrl = '';
if (!has('--skip-windows')) {
  const publishFlags = owner ? `-c.publish.provider=github -c.publish.owner=${owner} -c.publish.repo=${repo} -c.publish.releaseType=release` : '';
  const publish = owner && process.env.GH_TOKEN ? 'always' : 'never';
  run(`${npx} electron-builder --win nsis --publish ${publish} ${publishFlags}`.trim());
  if (!owner) {
    console.log('\n[!] release.config.json sem "github.owner": o instalador foi criado em release/, mas as apps instaladas NÃO se vão atualizar sozinhas.');
  } else if (publish === 'never') {
    console.log('\n[!] Sem GH_TOKEN: o instalador NÃO foi publicado. Carrega release/FuturePal-Setup-' + version + '.exe e release/latest.yml');
    console.log(`    numa release "v${version}" em https://github.com/${owner}/${repo}/releases/new (ou define GH_TOKEN e corre de novo).`);
  }
  if (owner) windowsUrl = `https://github.com/${owner}/${repo}/releases/latest`;
}

// 4. Android / iOS
if (!has('--skip-mobile')) {
  if (existsSync(join(root, 'android')) || existsSync(join(root, 'ios'))) run(`${npx} cap sync`);
}

// 5. SQL para o aviso nas apps
const notes = (flag('--notes') ?? '').replace(/'/g, "''");
const min = flag('--min');
const row = (platform, url) =>
  `insert into public.app_versions (platform, latest_version${min ? ', min_version' : ''}, notes, download_url, published_at)\n` +
  `values ('${platform}', '${version}'${min ? `, '${min}'` : ''}, '${notes}', '${url}', now())\n` +
  `on conflict (platform) do update set latest_version = excluded.latest_version${min ? ', min_version = excluded.min_version' : ''}, notes = excluded.notes,\n` +
  `  download_url = case when excluded.download_url <> '' then excluded.download_url else app_versions.download_url end, published_at = now();`;

console.log(`\n================ Versão ${version} pronta ================`);
console.log('\nQuando a versão estiver DISPONÍVEL (no GitHub / aprovada nas lojas), cola isto no Supabase > SQL Editor:\n');
if (!has('--skip-windows')) console.log(row('windows', windowsUrl) + '\n');
if (!has('--skip-mobile')) {
  console.log(row('android', cfg.storeUrls?.android || '') + '\n');
  console.log(row('ios', cfg.storeUrls?.ios || '') + '\n');
}
console.log('Dica: só atualiza a linha de cada plataforma DEPOIS de essa versão estar publicada; senão o aviso aparece antes de haver o que descarregar.');
console.log(`Para guardar no Git:  git add -A && git commit -m "Versão ${version}" && git tag v${version}`);
