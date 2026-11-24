// Assistente MyFuturePal: lógica pura (testável). A IA só interpreta a pergunta ou lê a foto;
// os números são SEMPRE calculados aqui, com os dados do aparelho.
import type { Transaction } from '../db/database';

export type IntentType = 'spending' | 'savings' | 'day' | 'category' | 'top' | 'unknown';
export interface Intent { type: IntentType; from: string; to: string; category: string | null }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const monthStart = (today: string) => today.slice(0, 8) + '01';
function lastMonth(today: string): [string, string] {
  const d = parse(today);
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return [iso(first), iso(last)];
}
function validDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = parse(s);
  return iso(d) === s;
}

/** Corrige o que a IA devolve: tipos conhecidos, datas válidas, de <= até. */
export function normalizeIntent(raw: unknown, today: string): Intent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const types: IntentType[] = ['spending', 'savings', 'day', 'category', 'top', 'unknown'];
  const type = types.includes(r.type as IntentType) ? (r.type as IntentType) : 'unknown';
  let from = typeof r.from === 'string' && validDate(r.from) ? r.from : monthStart(today);
  let to = typeof r.to === 'string' && validDate(r.to) ? r.to : today;
  if (type === 'day') to = from;
  if (from > to) [from, to] = [to, from];
  const category = typeof r.category === 'string' && r.category.trim() ? r.category.trim() : null;
  return { type: type === 'category' && !category ? 'spending' : type, from, to, category };
}

/**
 * Perguntas simples resolvidas sem IA (grátis e instantâneo): dias concretos, hoje/ontem,
 * gastos/poupança deste mês, do mês passado ou deste ano. Devolve null quando não percebe.
 */
export function quickIntent(text: string, today: string): Intent | null {
  const q = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const t = parse(today);
  const savings = /poup|econom|saved|saving|ahorr|epargn/.test(q);
  const spending = /gast|despes|spent|spend|expens|paguei|compr/.test(q);

  // dia concreto: 12/11, 12/11/2026, 2026-11-12, "dia 12", hoje, ontem
  let day: string | null = null;
  const dm = q.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  const isoM = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const diaM = q.match(/\b(?:dia|day|el dia|le)\s+(\d{1,2})\b/);
  if (isoM) day = `${isoM[1]}-${isoM[2]}-${isoM[3]}`;
  else if (dm) {
    let y = dm[3] ? Number(dm[3]) : t.getFullYear();
    if (y < 100) y += 2000;
    day = `${y}-${pad(Number(dm[2]))}-${pad(Number(dm[1]))}`;
  } else if (diaM) day = `${today.slice(0, 8)}${pad(Number(diaM[1]))}`;
  else if (/\b(hoje|today|hoy|aujourd)/.test(q)) day = today;
  else if (/\b(ontem|yesterday|ayer|hier)\b/.test(q)) day = iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1));
  if (day) return validDate(day) ? { type: 'day', from: day, to: day, category: null } : null;

  if (!savings && !spending) return null;
  // categorias ou períodos mais elaborados ("em restaurantes", "desde março") ficam para a IA
  if (/\b(em|com|on|in|at|for|desde|since|entre|between|depuis|pour|para)\b/.test(q)) return null;
  const type: IntentType = savings ? 'savings' : 'spending';
  if (/mes passado|ultimo mes|last month|mes pasado|mois dernier/.test(q)) { const [f, l] = lastMonth(today); return { type, from: f, to: l, category: null }; }
  if (/este ano|neste ano|this year|este ano|cette annee|este año|ano/.test(q) && !/mes|month|mois/.test(q)) return { type, from: `${today.slice(0, 4)}-01-01`, to: today, category: null };
  if (/este mes|neste mes|this month|ce mois|mes/.test(q) || /^\W*(quanto|how much)/.test(q)) return { type, from: monthStart(today), to: today, category: null };
  return null;
}

export interface SpendSummary { totalCents: number; count: number; byCategory: Array<{ categoryId: string; cents: number }>; days: number; avgPerDayCents: number }

/** Despesas entre duas datas (inclusive), agrupadas por categoria (maior primeiro). */
export function spendSummary(txs: Transaction[], from: string, to: string, categoryId?: string): SpendSummary {
  const list = txs.filter((t) => t.deletedAt === null && t.type === 'expense' && t.date >= from && t.date <= to && (!categoryId || t.categoryId === categoryId));
  const map = new Map<string, number>();
  for (const t of list) map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amountCents);
  const totalCents = list.reduce((s, t) => s + t.amountCents, 0);
  const days = Math.max(1, Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1);
  return {
    totalCents, count: list.length, days, avgPerDayCents: Math.round(totalCents / days),
    byCategory: [...map].map(([categoryId, cents]) => ({ categoryId, cents })).sort((a, b) => b.cents - a.cents),
  };
}

/** Movimentos de um dia (despesas e rendimentos). */
export function dayTransactions(txs: Transaction[], day: string): Transaction[] {
  return txs.filter((t) => t.deletedAt === null && t.date === day).sort((a, b) => b.amountCents - a.amountCents);
}

/** Encontra a categoria pelo nome (sem acentos, maiúsculas ou palavras a mais). */
export function matchCategory<T extends { id: string; label: string }>(name: string | null, cats: T[]): T | null {
  if (!name) return null;
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const q = n(name);
  return cats.find((c) => n(c.label) === q) ?? cats.find((c) => n(c.label).includes(q) || q.includes(n(c.label))) ?? null;
}

export interface ReceiptGuess { date: string; amountCents: number; description: string; category: string | null; currency: string | null }

/** Valida o que a IA leu da fatura. null = não conseguiu ler um valor. */
export function normalizeReceipt(raw: unknown, today: string): ReceiptGuess | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cents = Math.round(Number(r.totalCents));
  if (r.ok === false || !Number.isFinite(cents) || cents <= 0 || cents > 100_000_000) return null;
  const date = typeof r.date === 'string' && validDate(r.date) && r.date <= today ? r.date : today;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 80) : '');
  return {
    date, amountCents: cents,
    description: text(r.description) || text(r.merchant),
    category: text(r.category) || null,
    currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
  };
}

/** Reduz uma foto para enviar menos dados (e gastar menos) — lado maior até `max` px, JPEG. */
/** Foto quadrada e pequena (para guardar e sincronizar sem pesar): recorta o centro. */
export async function squareImage(file: Blob, size = 360, quality = 0.82): Promise<string> {
  const bmp = await createImageBitmap(file), side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = Math.min(size, side);
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export async function shrinkImage(file: Blob, max = 1600, quality = 0.8): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
