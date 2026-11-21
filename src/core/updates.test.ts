import { describe, it, expect } from 'vitest';
import { evaluate, type VersionRow } from './updates';

const row = (latest: string, min = '0.0.0', url = ''): VersionRow => ({ platform: 'android', latest_version: latest, min_version: min, notes: 'Novidades', download_url: url });

describe('evaluate (aviso de atualização)', () => {
  it('current when on the latest version', () => {
    expect(evaluate(row('1.2.0'), '1.2.0', 'android').status).toBe('current');
    expect(evaluate(row('1.2.0'), '1.3.0', 'android').status).toBe('current'); // build de teste mais nova
  });
  it('available when a newer version exists', () => {
    const r = evaluate(row('1.3.0'), '1.2.0', 'android');
    expect(r.status).toBe('available');
    expect(r.latest).toBe('1.3.0');
    expect(r.url).toContain('play.google.com'); // sem URL na tabela usa a loja por omissão
  });
  it('required when below min_version', () => {
    expect(evaluate(row('2.0.0', '1.5.0', 'https://x'), '1.4.9', 'android')).toMatchObject({ status: 'required', url: 'https://x' });
  });
  it('unknown without data (offline or table missing)', () => {
    expect(evaluate(null, '1.0.0', 'windows').status).toBe('unknown');
  });
});

import { apkFromRelease } from './updates';
describe('APK do GitHub', () => {
  it('lê a versão e o link do .apk da release', () => {
    const r = apkFromRelease({ tag_name: 'v0.2.7', body: ' Novidades ', assets: [{ name: 'latest.yml', browser_download_url: 'x' }, { name: 'FuturePal-0.2.7.apk', browser_download_url: 'https://g/a.apk' }] });
    expect(r).toEqual({ version: '0.2.7', notes: 'Novidades', url: 'https://g/a.apk' });
  });
  it('ignora releases sem APK, rascunhos e pré-lançamentos', () => {
    expect(apkFromRelease({ tag_name: 'v1.0.0', assets: [] })).toBeNull();
    expect(apkFromRelease({ tag_name: 'v1.0.0', prerelease: true, assets: [{ name: 'a.apk', browser_download_url: 'u' }] })).toBeNull();
  });
});
