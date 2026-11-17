import { describe, it, expect, vi, afterEach } from 'vitest';
import { chat, listModels, testConnection, isConfigured, maskKey, type AiConfig } from './ai';

const base: AiConfig = { enabled: true, provider: 'openai', baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test-123456789', model: 'm1' };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('ai client', () => {
  it('OpenAI-compatible chat: right URL, bearer key and reply', async () => {
    const f = mockFetch(200, { choices: [{ message: { content: 'OK' } }] });
    const out = await chat(base, [{ role: 'user', content: 'hi' }], 10);
    expect(out).toBe('OK');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions'); // sem barra dupla
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-123456789');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'm1', max_tokens: 10 });
  });

  it('Anthropic: /messages, x-api-key and system prompt split out', async () => {
    const f = mockFetch(200, { content: [{ type: 'text', text: 'Olá' }] });
    const cfg = { ...base, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' };
    const out = await chat(cfg, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
    expect(out).toBe('Olá');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(h['x-api-key']).toBe('sk-test-123456789');
    expect(h.Authorization).toBeUndefined();
    const body = JSON.parse(String(init.body));
    expect(body.system).toBe('S');
    expect(body.messages).toEqual([{ role: 'user', content: 'U' }]);
  });

  it('errors carry the status and provider message', async () => {
    mockFetch(401, { error: { message: 'Invalid API key' } });
    await expect(chat(base, [{ role: 'user', content: 'x' }])).rejects.toThrow('401: Invalid API key');
    const r = await testConnection(base);
    expect(r.ok).toBe(false);
  });

  it('listModels falls back to preset list when /models does not exist (Perplexity)', async () => {
    mockFetch(404, 'not found');
    const ids = await listModels({ ...base, provider: 'perplexity', baseUrl: 'https://api.perplexity.ai' });
    expect(ids).toContain('sonar');
  });

  it('listModels strips Gemini "models/" prefix and sorts', async () => {
    mockFetch(200, { data: [{ id: 'models/b' }, { id: 'models/a' }] });
    expect(await listModels(base)).toEqual(['a', 'b']);
  });

  it('isConfigured / maskKey', () => {
    expect(isConfigured(base)).toBe(true);
    expect(isConfigured({ ...base, apiKey: '' })).toBe(false);
    expect(isConfigured({ ...base, provider: 'ollama', apiKey: '' })).toBe(true);
    expect(isConfigured({ ...base, enabled: false })).toBe(false);
    expect(maskKey('sk-test-123456789')).toBe('sk-t…6789');
    expect(maskKey('')).toBe('');
  });
});
