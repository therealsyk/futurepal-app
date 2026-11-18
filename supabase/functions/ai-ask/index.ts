// Edge Function "ai-ask" do Assistente FuturePal (Deno, corre no Supabase).
// Faz SEMPRE estas verificações antes de gastar dinheiro com a IA:
//   1) sessão iniciada  2) assistente ligado e com chave  3) subscrição Plus/Pro ativa (tabela subscriptions)
//   4) quota do mês da pessoa  5) teto de gastos do mês para todos.
// Os cálculos das despesas são feitos NA APP; aqui a IA só recebe:
//   - "intent": a pergunta da pessoa e os nomes das categorias -> devolve o que ela quer saber (JSON)
//   - "receipt": a foto de uma fatura -> devolve data, valor, loja e categoria sugerida (JSON)
//
// Segredos (Supabase > Edge Functions > Secrets):
//   AI_API_KEY        chave do fornecedor (sem ela o assistente responde "brevemente" e não há custos)
//   AI_BASE_URL       predefinido: https://api.groq.com/openai/v1  (qualquer API compatível com OpenAI)
//   AI_MODEL          modelo de texto (predefinido: llama-3.1-8b-instant)
//   AI_VISION_MODEL   modelo que lê imagens (predefinido: meta-llama/llama-4-scout-17b-16e-instruct)
//   AI_PRICE_IN / AI_PRICE_OUT  preço em cêntimos por milhão de tokens (para o teto; predefinido 10 / 30)
// Publicar:  npx supabase functions deploy ai-ask

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const env = (k: string, d = '') => Deno.env.get(k) ?? d;

const MAX_IMAGE_CHARS = 6_000_000; // ~4,5 MB em base64

function intentPrompt(today: string, categories: string[], lang: string): string {
  return [
    `You turn a personal-finance question into JSON. Today is ${today}. Answer ONLY with JSON:`,
    `{"type":"spending"|"savings"|"day"|"category"|"top"|"unknown","from":"YYYY-MM-DD","to":"YYYY-MM-DD","category":string|null}`,
    `- "spending": how much was spent in a period. "savings": how much was saved / income vs spending.`,
    `- "day": were there expenses on a specific day (from = to = that day). "category": spending in one category.`,
    `- "top": where the money went (biggest categories). "unknown": anything else (not about the user's money).`,
    `- If no period is given use the current month. "this year" = Jan 1 to today.`,
    `- category must be one of: ${JSON.stringify(categories.slice(0, 120))} or null.`,
    `The question is in language "${lang}".`,
  ].join('\n');
}

function receiptPrompt(today: string, categories: string[]): string {
  return [
    `Read this receipt/invoice photo. Today is ${today}. Answer ONLY with JSON:`,
    `{"ok":boolean,"date":"YYYY-MM-DD"|null,"totalCents":integer|null,"currency":"EUR"|string|null,"merchant":string|null,"category":string|null,"description":string|null}`,
    `- totalCents is the FINAL total paid (with VAT), in cents. ok=false if it is not a receipt or is unreadable.`,
    `- category must be one of: ${JSON.stringify(categories.slice(0, 120))} or null.`,
    `- description: short, e.g. "Supermercado Continente".`,
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  // 1) quem é
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(token);
  const user = u?.user;
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  let body: { mode?: string; text?: string; image?: string; today?: string; categories?: string[]; lang?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const mode = body.mode === 'receipt' ? 'receipt' : 'intent';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? '') ? body.today! : new Date().toISOString().slice(0, 10);
  const categories = Array.isArray(body.categories) ? body.categories.filter((c) => typeof c === 'string').map((c) => c.slice(0, 60)) : [];

  // 2) ligado?
  const { data: cfg } = await admin.from('ai_settings').select('*').eq('id', 1).maybeSingle();
  if (!env('AI_API_KEY') || cfg?.enabled === false) return json({ ok: false, error: 'coming_soon' });

  // 3) subscrição ativa (a fonte de verdade é o servidor, não o aparelho)
  const { data: sub } = await admin.from('subscriptions').select('plan,status,current_period_end').eq('user_id', user.id).maybeSingle();
  const active = !!sub && ['active', 'trialing'].includes(sub.status) && new Date(sub.current_period_end) > new Date();
  if (!active) return json({ ok: false, error: 'no_subscription' }, 403);

  // 4) quota da pessoa  5) teto geral
  const month = new Date().toISOString().slice(0, 7);
  const { data: use } = await admin.from('ai_usage').select('questions,photos').eq('user_id', user.id).eq('month', month).maybeSingle();
  // Pro (e o antigo Família) tem 3x a quota do Plus
  const k = sub!.plan === 'plus' ? 1 : 3;
  const maxQ = (cfg?.monthly_questions ?? 100) * k;
  const baseP = cfg?.monthly_photos ?? 30;
  const maxP = k === 1 ? baseP : Math.round(baseP * 10 / 3); // Plus 30 -> Pro 100
  const usedQ = use?.questions ?? 0;
  const usedP = use?.photos ?? 0;
  if (mode === 'intent' && usedQ >= maxQ) return json({ ok: false, error: 'quota' });
  if (mode === 'receipt' && usedP >= maxP) return json({ ok: false, error: 'quota' });
  const budget = (cfg?.budget_cents ?? 0) * 1_000_000;
  if (budget > 0) {
    const { data: spent } = await admin.rpc('ai_month_cost', { p_month: month });
    if (Number(spent ?? 0) >= budget) return json({ ok: false, error: 'paused' });
  }

  // pedido à IA
  let messages: unknown[];
  let model: string;
  if (mode === 'receipt') {
    const img = String(body.image ?? '');
    if (!img.startsWith('data:image/') || img.length > MAX_IMAGE_CHARS) return json({ ok: false, error: 'bad_image' }, 400);
    model = env('AI_VISION_MODEL', 'meta-llama/llama-4-scout-17b-16e-instruct');
    messages = [{ role: 'user', content: [{ type: 'text', text: receiptPrompt(today, categories) }, { type: 'image_url', image_url: { url: img } }] }];
  } else {
    const text = String(body.text ?? '').trim().slice(0, 500);
    if (!text) return json({ ok: false, error: 'bad_request' }, 400);
    model = env('AI_MODEL', 'llama-3.1-8b-instant');
    messages = [{ role: 'system', content: intentPrompt(today, categories, String(body.lang ?? 'pt-PT')) }, { role: 'user', content: text }];
  }

  const r = await fetch(env('AI_BASE_URL', 'https://api.groq.com/openai/v1').replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('AI_API_KEY')}` },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 300, response_format: { type: 'json_object' } }),
  });
  if (!r.ok) {
    console.error('ai error', r.status, (await r.text()).slice(0, 300));
    return json({ ok: false, error: 'ai_error' }, 502);
  }
  const out = await r.json();
  const usage = out.usage ?? {};
  const cost = (usage.prompt_tokens ?? 0) * Number(env('AI_PRICE_IN', '10')) + (usage.completion_tokens ?? 0) * Number(env('AI_PRICE_OUT', '30'));
  await admin.rpc('ai_add_usage', { p_user: user.id, p_month: month, p_questions: mode === 'intent' ? 1 : 0, p_photos: mode === 'receipt' ? 1 : 0, p_cost: Math.round(cost) });

  let result: unknown = null;
  try { result = JSON.parse(out.choices?.[0]?.message?.content ?? 'null'); } catch { /* resposta inválida */ }
  if (!result || typeof result !== 'object') return json({ ok: false, error: 'ai_error' }, 502);

  return json({
    ok: true,
    result,
    remaining: { questions: maxQ - usedQ - (mode === 'intent' ? 1 : 0), photos: maxP - usedP - (mode === 'receipt' ? 1 : 0) },
  });
});
