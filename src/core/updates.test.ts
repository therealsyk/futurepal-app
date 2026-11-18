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
