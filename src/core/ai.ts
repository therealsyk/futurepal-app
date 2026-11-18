// Ligação opcional a um modelo de IA escolhido pela pessoa (a chave é dela e fica só neste aparelho).
// Quase todos os fornecedores falam o formato OpenAI (/chat/completions); a Anthropic tem o seu.

export type AiKind = 'openai' | 'anthropic';

export interface AiPreset {
  id: string;
  label: string;
  baseUrl: string;
  kind: AiKind;
  needsKey: boolean;
  models?: string[]; // sugestões (quando o fornecedor não tem /models ou para começar)
  keyUrl?: string; // onde se cria a chave
}

export const AI_PRESETS: AiPreset[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', kind: 'openai', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', kind: 'anthropic', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', kind: 'openai', needsKey: true, keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', kind: 'openai', needsKey: true, keyUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', kind: 'openai', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', kind: 'openai', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'perplexity', label: 'Perplexity', baseUrl: 'https://api.perplexity.ai', kind: 'openai', needsKey: true,
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'], keyUrl: 'https://www.perplexity.ai/settings/api' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', kind: 'openai', needsKey: false },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', kind: 'openai', needsKey: false },
  { id: 'custom', label: 'Outro (compatível com OpenAI)', baseUrl: '', kind: 'openai', needsKey: false },
];

export interface AiConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const STORAGE_KEY = 'wallet.ai';
export const DEFAULT_AI: AiConfig = { enabled: false, provider: 'openai', baseUrl: AI_PRESETS[0].baseUrl, apiKey: '', model: '' };

export function getPreset(id: string): AiPreset | undefined {
  return AI_PRESETS.find((p) => p.id === id);
}

// A chave fica no armazenamento local deste aparelho e NUNCA é sincronizada para o Supabase.
export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_AI, ...JSON.parse(raw) } : { ...DEFAULT_AI };
  } catch {
    return { ...DEFAULT_AI };
  }
}

export function saveAiConfig(cfg: AiConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* sem storage */ }
}

export function clearAiConfig(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* sem storage */ }
}

export function maskKey(key: string): string {
  return key.length > 10 ? key.slice(0, 4) + '…' + key.slice(-4) : key ? '••••' : '';
}

export function isConfigured(cfg: AiConfig): boolean {
  const p = getPreset(cfg.provider);
  return Boolean(cfg.enabled && cfg.baseUrl && cfg.model && (!p?.needsKey || cfg.apiKey));
}

function root(cfg: AiConfig): string {
  return cfg.baseUrl.trim().replace(/\/+$/, '');
}

function headers(cfg: AiConfig): Record<string, string> {
  const p = getPreset(cfg.provider);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (p?.kind === 'anthropic') {
    h['x-api-key'] = cfg.apiKey;
    h['anthropic-version'] = '2023-06-01';
    h['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (cfg.apiKey) {
    h.Authorization = `Bearer ${cfg.apiKey}`;
  }
  return h;
}

// No .exe (Electron) os pedidos passam pelo processo principal para não esbarrarem no CORS;
// no telemóvel o CapacitorHttp faz o mesmo; no browser usa-se fetch normal.
interface BridgeResponse { status: number; body: string }
type Bridge = { httpRequest?: (req: { url: string; method: string; headers: Record<string, string>; body?: string }) => Promise<BridgeResponse> };

async function request(url: string, method: string, hdrs: Record<string, string>, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const bridge = (globalThis as unknown as { __electronBridge?: Bridge }).__electronBridge;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  let status: number; let text: string;
  if (bridge?.httpRequest) {
    const r = await bridge.httpRequest({ url, method, headers: hdrs, body: payload });
    status = r.status; text = r.body;
  } else {
    const r = await fetch(url, { method, headers: hdrs, body: payload });
    status = r.status; text = await r.text();
  }
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* não é JSON */ }
  return { status, json, text };
}

function errorText(status: number, json: any, text: string): string {
  const m = json?.error?.message ?? json?.error ?? json?.message ?? text.slice(0, 160);
  return `${status}: ${typeof m === 'string' ? m : JSON.stringify(m)}`;
}

export async function listModels(cfg: AiConfig): Promise<string[]> {
  const p = getPreset(cfg.provider);
  const r = await request(root(cfg) + '/models', 'GET', headers(cfg));
  if (r.status === 404 && p?.models) return p.models;
  if (r.status < 200 || r.status >= 300) throw new Error(errorText(r.status, r.json, r.text));
  const items = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : [];
  const ids = items.map((m: any) => String(m.id ?? m.name ?? '')).filter(Boolean).map((s: string) => s.replace(/^models\//, ''));
  return ids.length ? Array.from(new Set<string>(ids)).sort() : (p?.models ?? []);
}

// Conteúdo: texto simples, ou partes (texto + imagem) para modelos com visão.
export type ContentPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }

const textOf = (c: ChatMessage['content']) => (typeof c === 'string' ? c : c.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n'));

function toOpenAI(m: ChatMessage) {
  if (typeof m.content === 'string') return m;
  return { role: m.role, content: m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: p.dataUrl } })) };
}
function toAnthropic(m: ChatMessage) {
  if (typeof m.content === 'string') return m;
  return {
    role: m.role,
    content: m.content.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      const [, mediaType = 'image/png', data = ''] = /^data:([^;]+);base64,(.*)$/.exec(p.dataUrl) ?? [];
      return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
    }),
  };
}

export async function chat(cfg: AiConfig, messages: ChatMessage[], maxTokens = 800): Promise<string> {
  const p = getPreset(cfg.provider);
  if (p?.kind === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system').map(toAnthropic);
    const r = await request(root(cfg) + '/messages', 'POST', headers(cfg), { model: cfg.model, max_tokens: maxTokens, system: system || undefined, messages: rest });
    if (r.status < 200 || r.status >= 300) throw new Error(errorText(r.status, r.json, r.text));
    return (r.json?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }
  const r = await request(root(cfg) + '/chat/completions', 'POST', headers(cfg), { model: cfg.model, messages: messages.map(toOpenAI), max_tokens: maxTokens });
  if (r.status < 200 || r.status >= 300) throw new Error(errorText(r.status, r.json, r.text));
  return String(r.json?.choices?.[0]?.message?.content ?? '');
}

// Teste curto: pede uma resposta mínima ao modelo escolhido.
export async function testConnection(cfg: AiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const out = await chat(cfg, [{ role: 'user', content: 'Reply with the single word: OK' }], 16);
    return { ok: true, message: out.trim().slice(0, 60) || 'OK' };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return { ok: false, message: msg.includes('Failed to fetch') ? 'network/CORS' : msg };
  }
}
