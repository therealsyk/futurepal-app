// Importar extratos bancários e outros documentos.
// Formatos: CSV / Excel (colunas detetadas automaticamente), OFX/QFX, QIF, PDF (texto) e,
// com um modelo de IA ligado, PDFs difíceis e fotografias (talões, capturas do homebanking).
// Tudo é convertido para StatementRow e revisto pela pessoa antes de entrar na app.

export interface StatementRow {
  date: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // sempre positivo
  type: 'expense' | 'income';
  category?: string; // nome da categoria, se o ficheiro tiver essa coluna
  signed?: boolean; // o valor veio com sinal (ou de colunas débito/crédito); false = só positivos, tipo incerto
}

// ---------------------------------------------------------------- números e datas
/** "1.234,56" · "1,234.56" · "-12,50 €" · "(12.50)" · "12,50-" -> cêntimos com sinal (null se não for número). */
export function parseSignedAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  let s = String(raw ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  if (/^\s*-/.test(s) || /^\s*−/.test(s)) { neg = true; }
  if (/\bD\b|\bDB\b/i.test(s) && !/\bC\b|\bCR\b/i.test(s)) neg = true; // "12,50 D" (débito)
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  let intPart = s, frac = '';
  // separador decimal = o último, se tiver 1–2 dígitos depois
  if (dec >= 0 && s.length - dec - 1 <= 2 && s.length - dec - 1 > 0) { intPart = s.slice(0, dec); frac = s.slice(dec + 1); }
  else if (dec >= 0 && s.length - dec - 1 === 0) { intPart = s.slice(0, dec); }
  intPart = intPart.replace(/[.,]/g, '');
  if (!intPart && !frac) return null;
  const cents = parseInt(intPart || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  return neg ? -cents : cents;
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS: Record<string, number> = {
  jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

export type DateOrder = 'DMY' | 'MDY' | 'YMD';

/** Data em texto ou Date -> 'YYYY-MM-DD'. order decide 03/04 (DMY = 3 de abril). */
export function parseDate(raw: unknown, order: DateOrder = 'DMY'): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) { // número de série do Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(raw ?? '').trim().toLowerCase();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX: 20261105…
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return order === 'MDY' ? valid(y, +m[1], +m[2]) : valid(y, +m[2], +m[1]);
  }
  m = /^(\d{1,2})[\s-]+([a-zç]{3})[a-zç.]*[\s-]+(\d{2,4})/.exec(s); // 05 nov 2026 / 5-Nov-26
  if (m && MONTHS[m[2]]) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2]], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

/** Descobre a ordem das datas olhando para todas: se algum "primeiro número" > 12 é DMY; se o segundo > 12 é MDY. */
export function guessDateOrder(values: unknown[], fallback: DateOrder = 'DMY'): DateOrder {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(String(v ?? '').trim());
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'MDY' : dmy > mdy ? 'DMY' : fallback;
}

// ---------------------------------------------------------------- tabelas (CSV / Excel)
export interface ColumnMap { date: number; description: number; amount?: number; debit?: number; credit?: number; category?: number }

const H = {
  date: /^(data|date|fecha|dt)\b|data (mov|lan|oper|valor)|booking|transaction date|posted/i,
  valueDate: /data[\s.]*valor|value date/i,
  description: /descri|desc\b|movimento|hist[oó]rico|details?|memo|concept|narra|payee|benefici|refer[eê]ncia|libell/i,
  debit: /d[eé]bito|debit|sa[ií]da|withdraw|payments?\b|d[ée]bit/i,
  credit: /cr[eé]dito|credit|entrada|deposit|cr[ée]dit/i,
  amount: /montante|valor|amount|import(e|o)|quantia|montant|value\b/i,
  balance: /saldo|balance|solde/i,
  category: /^categor|category|cat[eé]gorie/i,
};

/** Procura a linha de cabeçalho e as colunas; null se não encontrar data + descrição + valor. */
export function detectColumns(rows: unknown[][]): { header: number; map: ColumnMap } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r].map((c) => String(c ?? '').trim());
    const find = (re: RegExp, skip: (i: number) => boolean = () => false) => cells.findIndex((c, i) => c && re.test(c) && !skip(i));
    let date = find(H.date, (i) => H.valueDate.test(cells[i]));
    if (date < 0) date = find(H.date);
    const description = find(H.description);
    if (date < 0 || description < 0) continue;
    const debit = find(H.debit);
    const credit = find(H.credit);
    const amount = find(H.amount, (i) => i === date || H.balance.test(cells[i]) || H.valueDate.test(cells[i]));
    const cat = find(H.category);
    const category = cat >= 0 && cat !== description ? cat : undefined;
    if (debit >= 0 || credit >= 0) return { header: r, map: { date, description, category, debit: debit >= 0 ? debit : undefined, credit: credit >= 0 ? credit : undefined, amount: debit < 0 && credit < 0 ? amount : undefined } };
    if (amount >= 0) return { header: r, map: { date, description, category, amount } };
  }
  return null;
}

/** Converte uma tabela (linhas de células) em movimentos. */
export function rowsFromTable(rows: unknown[][], map: ColumnMap, header: number, order?: DateOrder): StatementRow[] {
  const body = rows.slice(header + 1);
  const ord = order ?? guessDateOrder(body.map((r) => r[map.date]));
  const out: StatementRow[] = [];
  for (const r of body) {
    const date = parseDate(r[map.date], ord);
    if (!date) continue;
    let cents: number | null = null;
    let signed = true;
    if (map.amount !== undefined) {
      cents = parseSignedAmount(r[map.amount]);
      signed = cents !== null && (cents < 0 || /^[\s]*[-−(+]/.test(String(r[map.amount] ?? '')));
    } else {
      const d = map.debit !== undefined ? parseSignedAmount(r[map.debit]) : null;
      const c = map.credit !== undefined ? parseSignedAmount(r[map.credit]) : null;
      if (d) cents = -Math.abs(d);
      else if (c) cents = Math.abs(c);
    }
    if (!cents) continue;
    const description = String(r[map.description] ?? '').replace(/\s+/g, ' ').trim();
    const category = map.category !== undefined ? String(r[map.category] ?? '').trim() || undefined : undefined;
    out.push({ date, description, amountCents: Math.abs(cents), type: cents < 0 ? 'expense' : 'income', ...(category ? { category } : {}), ...(signed ? {} : { signed: false }) });
  }
  return out;
}

/** Texto de um ficheiro: UTF-8 se for válido, senão Windows-1252 (comum nos extratos dos bancos portugueses). */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Entre várias tabelas (folhas de Excel), escolhe a que dá mais movimentos. */
export function bestTable(tables: unknown[][][]): StatementRow[] {
  let best: StatementRow[] = [];
  for (const rows of tables) {
    const det = detectColumns(rows);
    if (!det) continue;
    const found = rowsFromTable(rows, det.map, det.header);
    if (found.length > best.length) best = found;
  }
  return best;
}

// ---------------------------------------------------------------- OFX / QIF
export function parseOFX(text: string): StatementRow[] {
  const out: StatementRow[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const tag = (t: string) => new RegExp(`<${t}>([^<\\r\\n]*)`, 'i').exec(b)?.[1]?.trim() ?? '';
    const date = parseDate(tag('DTPOSTED'));
    const cents = parseSignedAmount(tag('TRNAMT').replace(',', '.'));
    if (!date || !cents) continue;
    const description = [tag('NAME'), tag('MEMO')].filter(Boolean).join(' · ');
    out.push({ date, description, amountCents: Math.abs(cents), type: cents < 0 ? 'expense' : 'income' });
  }
  return out;
}

export function parseQIF(text: string, order: DateOrder = 'DMY'): StatementRow[] {
  const out: StatementRow[] = [];
  for (const rec of text.split(/^\^/m)) {
    const line = (c: string) => rec.split(/\r?\n/).find((l) => l.startsWith(c))?.slice(1).trim() ?? '';
    const date = parseDate(line('D').replace(/'/g, '/'), order);
    const cents = parseSignedAmount(line('T') || line('U'));
    if (!date || !cents) continue;
    const description = [line('P'), line('M')].filter(Boolean).join(' · ');
    out.push({ date, description, amountCents: Math.abs(cents), type: cents < 0 ? 'expense' : 'income' });
  }
  return out;
}

// ---------------------------------------------------------------- texto (PDF)
/**
 * Linhas de extrato em texto: "05/11/2026  05/11/2026  COMPRA CONTINENTE   -45,20   1.234,56".
 * Usa o primeiro valor monetário depois da descrição (o último costuma ser o saldo).
 */
export function rowsFromText(text: string, order: DateOrder = 'DMY'): StatementRow[] {
  const out: StatementRow[] = [];
  const money = /[-−(]?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})\)?-?|[-−]?\d+[.,]\d{2}-?/g;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ord = guessDateOrder(lines.map((l) => l.split(/\s+/)[0]), order);
  for (const l of lines) {
    const dm = /^(\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?|\d{4}-\d{2}-\d{2})\s+/.exec(l);
    if (!dm) continue;
    let rest = l.slice(dm[0].length);
    const second = /^(\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)\s+/.exec(rest); // data-valor
    if (second) rest = rest.slice(second[0].length);
    const amounts = [...rest.matchAll(money)];
    if (amounts.length === 0) continue;
    const first = amounts[0];
    const description = rest.slice(0, first.index).replace(/\s+/g, ' ').trim();
    if (!description) continue;
    let date = parseDate(dm[1], ord);
    if (!date && /^\d{1,2}[-/.]\d{1,2}$/.test(dm[1])) date = parseDate(`${dm[1]}/${new Date().getFullYear()}`, ord);
    const cents = parseSignedAmount(first[0]);
    if (!date || !cents) continue;
    // Extratos com coluna Débito/Crédito: se há 3 números (débito/crédito + saldo), o sinal vem da posição;
    // sem sinal explícito, assume-se despesa (é o caso mais comum nos extratos).
    const signed = /[-−(]|-$/.test(first[0]);
    out.push({ date, description, amountCents: Math.abs(cents), type: signed || cents < 0 ? 'expense' : guessIncome(description) ? 'income' : 'expense' });
  }
  return out;
}
function guessIncome(desc: string): boolean {
  return /sal[aá]rio|vencimento|ordenado|transf.*(rec|cr[eé]dito)|reembolso|devolu|payroll|salary|refund|dep[oó]sito/i.test(desc);
}

export async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // junta os pedaços por linha (mesma coordenada y), da esquerda para a direita
    const byY = new Map<number, Array<{ x: number; s: string }>>();
    for (const it of content.items as Array<{ str: string; transform: number[] }>) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...byY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      byY.set(key, [...(byY.get(key) ?? []), { x: it.transform[4], s: it.str }]);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      lines.push(byY.get(y)!.sort((a, b) => a.x - b.x).map((p2) => p2.s).join('  '));
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- categorias e duplicados
const KEYWORDS: Array<[RegExp, string]> = [
  [/continente|pingo doce|lidl|auchan|minipre|intermarch|aldi|mercadona|supermerc|grocer/i, 'catGroceries'],
  [/restaur|mcdonald|burger|pizza|uber ?eats|glovo|bolt food|tasca|snack|kfc/i, 'catFood'],
  [/caf[eé]|starbucks|delta|nespresso|padaria|pastel/i, 'catCoffee'],
  [/galp|bp |repsol|prio|cepsa|shell|combust|gasolin|gas station/i, 'catGas'],
  [/via ?verde|portage|parque|parking|estacion|emel/i, 'catParking'],
  [/uber|bolt|free ?now|taxi|t[aá]xi|cabify/i, 'catTaxi'],
  [/cp |comboio|metro|carris|navegante|stcp|bus|autocarro|flixbus/i, 'catTransport'],
  [/ryanair|easyjet|tap air|tap portugal|voo|flight|airline/i, 'catFlight'],
  [/edp|endesa|iberdrola|goldenergy|eletricid|electric/i, 'catElectricity'],
  [/[aá]guas|epal|smas|water/i, 'catWater'],
  [/meo|nos |vodafone|nowo|digi |internet|fibra/i, 'catInternet'],
  [/netflix|spotify|disney|hbo|prime video|youtube|apple\.com|icloud|google (one|play)|subscri/i, 'catSubscriptions'],
  [/farm[aá]cia|pharma|wells/i, 'catPharmacy'],
  [/hospital|cl[ií]nica|m[eé]dic|cuf|lusiadas|sa[uú]de/i, 'catDoctor'],
  [/dentist|dent[aá]r/i, 'catDentist'],
  [/renda|arrendamento|\brent\b/i, 'catRent'],
  [/seguro|fidelidade|allianz|tranquilidade|generali|ageas|insurance/i, 'catInsurance'],
  [/imposto|financas|finan[cç]as|\bat\b|iuc|imi|imt|taxes|tax\b/i, 'catTaxes'],
  [/comiss[aã]o|manuten[cç][aã]o de conta|despesas? banc|bank fee|imposto do selo/i, 'catBankFees'],
  [/zara|primark|h&m|pull ?&? ?bear|bershka|mango|decathlon|roupa|cloth/i, 'catClothes'],
  [/amazon|aliexpress|fnac|worten|ikea|leroy|shein|temu|el corte/i, 'catShopping'],
  [/vet|animal|pet|zooplus|kiwoko/i, 'catAnimals'],
  [/gin[aá]sio|fitness|holmes|solinca|gym|sport/i, 'catSports'],
  [/cinema|nos cinemas|ticketline|bilhete|steam|playstation|xbox|nintendo/i, 'catLeisure'],
  [/hotel|booking\.com|airbnb|alojamento/i, 'catHotel'],
  [/escola|propina|universid|curso|livraria|bertrand|education/i, 'catEducation'],
  [/sal[aá]rio|vencimento|ordenado|payroll|salary/i, 'catSalary'],
];

/** Sugere uma categoria: primeiro pelo histórico (mesma descrição), depois por palavras-chave. */
export function suggestCategory(
  description: string,
  type: 'expense' | 'income',
  cats: Array<{ id: string; nameKey?: string }>,
  history: Array<{ description: string; categoryId: string }>,
): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\d+/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const d = norm(description);
  const past = d ? history.find((h) => norm(h.description) === d && cats.some((c) => c.id === h.categoryId)) : undefined;
  if (past) return past.categoryId;
  const byKey = (k: string) => cats.find((c) => c.nameKey === k)?.id;
  for (const [re, key] of KEYWORDS) if (re.test(description)) { const id = byKey(key); if (id) return id; }
  return type === 'income' ? byKey('catOtherIncome') ?? byKey('catSalary') : byKey('catOther') ?? byKey('catUnknown');
}

/** Chave para detetar movimentos repetidos (já na app ou repetidos no próprio ficheiro). */
export function dupKey(r: { date: string; amountCents: number; description: string }): string {
  return `${r.date}|${r.amountCents}|${r.description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

// ---------------------------------------------------------------- IA (PDFs difíceis e fotografias)
export const AI_EXTRACT_PROMPT = `Extract every bank/card transaction from the document.
Return ONLY JSON: {"transactions":[{"date":"YYYY-MM-DD","description":"...","amount":-12.34}]}
Rules: negative amount = money out (expense), positive = money in (income). Ignore balances, totals and headers.
If the year is missing, use the statement year. Do not invent transactions.`;

/** Lê a resposta da IA (pode vir com texto ou ```json à volta). */
export function rowsFromAiJson(reply: string): StatementRow[] {
  const m = /\{[\s\S]*\}/.exec(reply);
  if (!m) return [];
  let data: { transactions?: Array<{ date?: string; description?: string; amount?: number | string }> };
  try { data = JSON.parse(m[0]); } catch { return []; }
  const out: StatementRow[] = [];
  for (const t of data.transactions ?? []) {
    const date = parseDate(t.date, 'YMD');
    const cents = parseSignedAmount(typeof t.amount === 'number' ? t.amount : String(t.amount ?? '').replace(',', '.'));
    if (!date || !cents) continue;
    out.push({ date, description: String(t.description ?? '').trim(), amountCents: Math.abs(cents), type: cents < 0 ? 'expense' : 'income' });
  }
  return out;
}
