// Revisão das traduções. Corre com: node scripts/i18n-check.mjs   (sai com erro se encontrar problemas)
//  1. Chaves usadas no código (t('a.b')) que não existem em algum idioma.
//  2. Chaves que existem num idioma e faltam noutro.
//  3. Texto em português escrito diretamente no JSX/atributos (devia passar por t()).
//  4. Valores em inglês/espanhol/francês iguais ao português (provavelmente esquecidos sem traduzir).
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const I18N = path.join(ROOT, 'src/i18n');
const langs = fs.readdirSync(I18N).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const flat = (o, pre = '', out = {}) => { for (const [k, v] of Object.entries(o)) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = v; } return out; };
const dict = Object.fromEntries(langs.map((l) => [l, flat(JSON.parse(fs.readFileSync(path.join(I18N, l + '.json'), 'utf8')))]));
const base = dict['pt-PT'] ? 'pt-PT' : langs[0];
// o mesmo que o fallbackLng de src/main.tsx: es/fr caem para inglês, os restantes para pt-PT
const FALLBACK = { es: 'en', fr: 'en' };
const has1 = (l, k) => !!dict[l] && (k in dict[l] || `${k}_one` in dict[l] || `${k}_other` in dict[l]);
const has = (l, k) => has1(l, k) || has1(FALLBACK[l] || 'pt-PT', k);

const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name) && !/\.test\./.test(f.name)) files.push(p); } };
walk(path.join(ROOT, 'src'));
files.splice(0, files.length, ...files.filter((f) => !f.endsWith('phrases.ts')));

const problems = { missingKey: [], missingLang: [], missingPhrase: [], hardcoded: [], untranslated: [] };
// frases L('...') têm de existir em src/i18n/phrases.ts
const phraseSrc = fs.readFileSync(path.join(I18N, 'phrases.ts'), 'utf8');
const phraseSet = new Set([...phraseSrc.matchAll(/^  '([^']+)': \[/gm)].map((m) => m[1]));
const PT = /[ãõçáéíóúâêôà]|\b(de|da|do|para|com|não|sem|mês|ano|conta|contas|gastos|meta|metas|limite|ainda|já|todas|todos|nova|novo|ver|apagar|guardar|voltar|cancelar|criar|escolher|adicionar|movimentos|poupança|rendimento|despesa|despesas|salário)\b/i;
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  // 1. chaves usadas e não definidas (só chaves literais)
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]*[a-zA-Z0-9])'/g)) {
    for (const l of langs) if (!has(l, m[1])) problems.missingKey.push(`${rel}: '${m[1]}' falta em ${l}`);
  }
  for (const m of src.matchAll(/\bL\('([^']+)'\)/g)) if (!phraseSet.has(m[1])) problems.missingPhrase.push(`${rel}: L('${m[1]}') sem tradução em phrases.ts`);
  // 3. texto português no JSX: >Texto< ou atributos visíveis
  lines.forEach((ln, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;
    const code = ln.replace(/\{\/\*.*?\*\/\}/g, '').replace(/\/\/.*$/, '');
    const hits = [];
    for (const m of code.matchAll(/>([^<>{}]*[A-Za-zÀ-ú]{3,}[^<>{}]*)</g)) hits.push(m[1].trim());
    for (const m of code.matchAll(/\b(?:placeholder|title|aria-label|label)=["']([^"']{3,})["']/g)) hits.push(m[1]);
    for (const m of code.matchAll(/\?\s*'([^'{}]{4,})'\s*:\s*'([^'{}]{4,})'/g)) hits.push(m[1], m[2]);
    for (const m of code.matchAll(/confirm\('([^']+)'/g)) hits.push(m[1]);
    for (const h of hits) if (h && !h.includes('@') && PT.test(h) && !/^[\w.-]+$/.test(h)) problems.hardcoded.push(`${rel}:${i + 1}: ${h.slice(0, 80)}`);
  });
}
// 2. chaves em falta entre idiomas
for (const k of Object.keys(dict[base])) for (const l of langs) if (l !== base && !has(l, k.replace(/_(one|other)$/, ''))) problems.missingLang.push(`${k} falta em ${l}`);
// 4. iguais ao português nos idiomas estrangeiros
for (const l of langs.filter((x) => !x.startsWith('pt'))) for (const [k, v] of Object.entries(dict[l])) {
  const pv = dict[base][k];
  if (typeof v === 'string' && v === pv && v.length > 6 && PT.test(v)) problems.untranslated.push(`${l}: ${k} = "${v.slice(0, 60)}"`);
}

const WARN_ONLY = new Set(['untranslated']); // nomes iguais em vários idiomas (ex.: "Cancelar") não contam como erro
let total = 0;
for (const [name, list] of Object.entries(problems)) {
  const uniq = [...new Set(list)];
  if (!WARN_ONLY.has(name)) total += uniq.length;
  console.log(`\n== ${name}: ${uniq.length}`);
  for (const x of uniq.slice(0, Number(process.env.I18N_MAX || 400))) console.log('  ' + x);
}
console.log(`\nTotal: ${total}`);
process.exit(total ? 1 : 0);
