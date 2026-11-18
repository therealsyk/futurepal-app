import { describe, it, expect } from 'vitest';
import { sendFeedback } from './feedback';

describe('feedback', () => {
  it('valida antes de enviar', async () => {
    expect(await sendFeedback(null, { kind: 'idea', message: ' a ', language: 'pt-PT' })).toBe('feedback.errShort');
    expect(await sendFeedback(null, { kind: 'bug', message: 'Não abre', email: 'nada', language: 'pt-PT' })).toBe('feedback.errEmail');
    expect(await sendFeedback(null, { kind: 'bug', message: 'Não abre', language: 'pt-PT' })).toBe('feedback.errOffline');
  });
  it('envia versão, aparelho e mensagem', async () => {
    let row: any = null;
    const sb: any = { from: () => ({ insert: async (r: any) => { row = r; return { error: null }; } }) };
    expect(await sendFeedback(sb, { kind: 'idea', message: '  Modo escuro mais escuro  ', email: 'a@b.pt', language: 'pt-PT' })).toBeNull();
    expect(row).toMatchObject({ kind: 'idea', message: 'Modo escuro mais escuro', email: 'a@b.pt', language: 'pt-PT' });
    expect(typeof row.app_version).toBe('string');
  });
});
