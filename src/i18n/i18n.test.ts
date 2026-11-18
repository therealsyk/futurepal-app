import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pt from './pt-PT.json';
import en from './en.json';

// Garante que o inglês tem todos os textos do português (senão a app mostra português com a interface em inglês)
// e que todas as chaves fixas usadas no código existem nas duas línguas.
const flat = (o: Record<string, unknown>, p = ''): Record<string, unknown> =>
  Object.entries(o).reduce((acc, [k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...acc, ...flat(v as Record<string, unknown>, p + k + '.') } : { ...acc, [p + k]: v }), {});

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

describe('translations', () => {
  const P = flat(pt), E = flat(en);
  const has = (d: Record<string, unknown>, k: string) => k in d || Object.keys(d).some((x) => x.startsWith(k + '_'));

  it('English has every Portuguese key', () => {
    expect(Object.keys(P).filter((k) => !(k in E))).toEqual([]);
  });

  it('every t("key") used in the code exists in pt-PT and en', () => {
    const used = new Set<string>();
    for (const f of files(join(__dirname, '..'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]*[a-zA-Z0-9])'/g)) used.add(m[1]);
    }
    expect([...used].filter((k) => !has(P, k) || !has(E, k))).toEqual([]);
  });
});
