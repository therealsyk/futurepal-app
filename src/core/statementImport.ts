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
  jan: 1, ene: 1, gen: 1, fev: 2, feb: 2, mar: 3, mrz: 3, abr: 4, apr: 4, avr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, aou: 8,
  set: 9, sep: 9, out: 10, oct: 10, okt: 10, ott: 10, nov: 11, dez: 12, dec: 12, dic: 12,
};
/** Mês pelo nome (pt, en, es, fr, de, it; abreviado ou por extenso, com ou sem acentos). */
function monthOf(word: string): number | undefined {
  const w = word.toLowerCase().replace(/\.$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (w.startsWith('juil')) return 7;
  if (w.startsWith('juin')) return 6;
  return MONTHS[w.slice(0, 3)];
}

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
  m = /^(\d{1,2})[\s-]+(?:de\s+)?([a-zà-ÿ]{3}[a-zà-ÿ]*)\.?[\s-]+(?:de\s+)?(\d{2,4})/.exec(s); // 05 nov 2026 / 5-Nov-26 / 3 de novembro de 2026
  if (m && monthOf(m[2])) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], monthOf(m[2])!, +m[1]);
  m = /^([a-zà-ÿ]{3}[a-zà-ÿ]*)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s); // Apr 20, 2026 (Revolut e outros em inglês)
  if (m && monthOf(m[1])) return valid(+m[3], monthOf(m[1])!, +m[2]);
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
    const m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.]\d{2,4})?$/.exec(String(v ?? '').trim());
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
  // Se a coluna do valor tem negativos, os positivos são entradas (o sinal conta); só sem negativos é que é incerto.
  const colHasNegatives = map.amount !== undefined && body.some((r) => (parseSignedAmount(r[map.amount!]) ?? 0) < 0);
  for (const r of body) {
    const date = parseDate(r[map.date], ord);
    if (!date) continue;
    let cents: number | null = null;
    let signed = true;
    if (map.amount !== undefined) {
      cents = parseSignedAmount(r[map.amount]);
      signed = cents !== null && (colHasNegatives || cents < 0 || /^[\s]*[-−(+]/.test(String(r[map.amount] ?? '')));
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
// Os extratos em PDF variam muito de banco para banco. Cada linha é partida em "células" (blocos separados por
// 2+ espaços, como o pdfText os junta) e cada célula é data, valor ou texto. Depois:
//  • linha com data + texto + valor(es) = movimento; com 2+ valores, o último é o saldo;
//  • o sinal vem do próprio valor (-, ( ), D/C) ou, se não houver, da variação do saldo entre linhas;
//  • datas sem ano ("05.11", "05 NOV") usam o ano que aparece no documento;
//  • a descrição pode continuar na linha de baixo, ou a data+descrição numa linha e o valor na seguinte;
//  • linhas de saldo inicial/final e totais não contam como movimentos (mas o saldo serve de referência).

type Tok = { k: 'date'; v: string } | { k: 'amt'; v: number; signed: boolean } | { k: 'txt'; v: string };

const MONEY_CELL = /^[-−]?\s*(?:EUR|€|US\$|R\$|\$|£|GBP|USD|BRL|CHF)?\s*[-−+]?\s*\(?(?:\d{1,3}(?:[.,\s  ]\d{3})+|\d+)[.,]\d{2}\)?\s*-?\s*(?:EUR|€|US\$|R\$|\$|£|GBP|USD|BRL|CHF)?\s*(?:D|DB|C|CR)?$/i;
const MONEY_END = /\s+([-−]?\s*(?:EUR|€|US\$|R\$|\$|£|GBP|USD|BRL|CHF)?\s*[-−+]?\(?(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2}\)?-?\s*(?:EUR|€|US\$|R\$|\$|£|GBP|USD|BRL|CHF)?(?:\s(?:D|DB|C|CR))?)$/i;
const DATE_START = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?|\d{1,2}[\s.-]?[a-zà-ÿ]{3,9}\.?(?:[\s.-]\d{2,4})?|[a-zà-ÿ]{3,9}\.?\s\d{1,2},?(?:\s\d{4})?)(?=\s|$)/i;
const SKIP = /^(saldo|total|balance|a transportar|transporte|opening|closing|start(ing)? balance|beginning|ending balance|end balance|solde|kontostand|anfangssaldo|endsaldo)/i;
const NOISE = /^(card|cart[aã]o|to|from|para|de|ref(erence)?)\s*:|p[aá]gina|page \d|extrato|statement|iban|nif\b|swift|bic\b|descri[cç][aã]o|morada|address/i;

function moneyOf(raw: string): { v: number; signed: boolean } | null {
  const t = raw.trim();
  const credit = /\s?(C|CR)$/i.test(t);
  const debit = /\s?(D|DB)$/i.test(t);
  const cents = parseSignedAmount(t.replace(/\s?(D|DB|C|CR)$/i, '').replace(/[\s  ](?=\d{3}\b)/g, ''));
  if (cents === null) return null;
  const explicit = /[-−(]|-$/.test(t) || credit || debit || /^\s*\+/.test(t);
  return { v: debit ? -Math.abs(cents) : credit ? Math.abs(cents) : cents, signed: explicit };
}

function dateOf(raw: string, order: DateOrder, year: number): string | null {
  const s = raw.trim().toLowerCase();
  const named = /^[a-zà-ÿ]{3,9}\.?\s\d{1,2},?(\s\d{4})?$/.test(s); // "Apr 20, 2026" / "Apr 20"
  if (!/^\d/.test(s) && !named) return null;
  const full = parseDate(s, order);
  if (full && /^\S+(\s\S+){0,2}$/.test(s) && s.length <= 18) return full;
  if (named) { const n = /^([a-zà-ÿ]{3,9})\.?\s(\d{1,2}),?$/.exec(s); return n && monthOf(n[1]) ? valid(year, monthOf(n[1])!, +n[2]) : null; }
  let m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return order === 'MDY' ? valid(year, +m[1], +m[2]) : valid(year, +m[2], +m[1]);
  m = /^(\d{1,2})[\s.-]?([a-zà-ÿ]{3,9})\.?$/.exec(s);
  if (m && monthOf(m[2])) return valid(year, monthOf(m[2])!, +m[1]);
  return null;
}

function tokenize(line: string, order: DateOrder, year: number): Tok[] {
  const out: Tok[] = [];
  for (let cell of line.split(/\s{2,}|\t/)) {
    cell = cell.trim();
    if (!cell) continue;
    const d = dateOf(cell, order, year);
    if (d) { out.push({ k: 'date', v: d }); continue; }
    if (MONEY_CELL.test(cell)) { const m = moneyOf(cell); if (m) { out.push({ k: 'amt', ...m }); continue; } }
    // célula mista: datas no início, valores no fim, texto no meio
    const head: Tok[] = [];
    for (let i = 0; i < 2; i++) {
      const dm = DATE_START.exec(cell);
      const dd = dm ? dateOf(dm[1], order, year) : null;
      if (!dm || !dd) break;
      head.push({ k: 'date', v: dd });
      cell = cell.slice(dm[0].length).trim();
    }
    const tail: Tok[] = [];
    for (let i = 0; i < 3; i++) {
      const mm = MONEY_END.exec(cell);
      const mv = mm ? moneyOf(mm[1]) : null;
      if (!mm || !mv) break;
      tail.unshift({ k: 'amt', ...mv });
      cell = cell.slice(0, mm.index).trim();
    }
    if (!cell && head.length === 0 && tail.length) { out.push(...tail); continue; }
    out.push(...head);
    if (cell) out.push({ k: 'txt', v: cell });
    out.push(...tail);
  }
  return out;
}

/** O ano mais frequente no documento (para datas sem ano); senão o ano atual. */
function docYear(text: string): number {
  const count = new Map<number, number>();
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) count.set(+m[1], (count.get(+m[1]) ?? 0) + 1);
  let best = new Date().getFullYear(), n = 0;
  for (const [y, c] of count) if (c > n) { best = y; n = c; }
  return best;
}

export function rowsFromText(text: string, order: DateOrder = 'DMY'): StatementRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const year = docYear(text);
  const ord = guessDateOrder(lines.map((l) => l.split(/\s+/)[0]), order);
  type Raw = { date: string; desc: string; amt: number; signed: boolean; balance: number | null; openBal: number | null };
  const raw: Raw[] = [];
  let pending: { date: string; desc: string } | null = null; // data + descrição sem valor (o valor vem na linha seguinte)
  let lastOpen: number | null = null; // saldo de uma linha "Saldo anterior" logo antes
  let canContinue = false;

  const push = (date: string, desc: string, amts: Array<{ v: number; signed: boolean }>) => {
    const move = amts.length >= 2 ? amts.slice(0, -1) : amts;
    const pick = move.find((a) => a.v !== 0) ?? move[0]; // débito/crédito/saldo com uma coluna a zero
    raw.push({ date, desc, amt: pick.v, signed: pick.signed, balance: amts.length >= 2 ? amts[amts.length - 1].v : null, openBal: lastOpen });
    lastOpen = null; pending = null; canContinue = true;
  };

  for (const line of lines) {
    const toks = tokenize(line, ord, year);
    const dates = toks.filter((t): t is { k: 'date'; v: string } => t.k === 'date');
    const amts = toks.filter((t): t is { k: 'amt'; v: number; signed: boolean } => t.k === 'amt');
    const desc = toks.filter((t): t is { k: 'txt'; v: string } => t.k === 'txt').map((t) => t.v).join(' ').replace(/\s+/g, ' ').trim();

    // linha de totais (inicial, saídas, entradas, final): o 1.º valor é o saldo inicial
    if (desc && SKIP.test(desc)) { if (amts.length) lastOpen = amts[amts.length >= 3 ? 0 : amts.length - 1].v; pending = null; canContinue = false; continue; }
    if (dates.length && amts.length && desc) { push(dates[0].v, desc, amts); continue; }
    if (dates.length && desc && !amts.length) { pending = { date: dates[0].v, desc }; canContinue = false; continue; }
    if (pending && amts.length && !dates.length) { const p = pending as { date: string; desc: string }; push(p.date, [p.desc, desc].filter(Boolean).join(' '), amts); continue; }
    // descrição que continua na linha de baixo
    if (canContinue && desc && !dates.length && !amts.length && desc.length <= 40 && !NOISE.test(desc) && raw.length) {
      raw[raw.length - 1].desc += ' ' + desc;
      canContinue = false;
      continue;
    }
    canContinue = false;
  }

  // Sinal pela variação do saldo: descobre se o extrato vai do mais antigo para o mais recente ou ao contrário.
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  let asc = 0, dsc = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    if (a.balance === null || b.balance === null) continue;
    if (near(Math.abs(b.balance - a.balance), Math.abs(b.amt))) asc++;
    if (near(Math.abs(a.balance - b.balance), Math.abs(a.amt))) dsc++;
  }
  const deltaSign = (i: number): number | null => {
    const r = raw[i];
    if (r.balance === null) return null;
    const other = asc >= dsc ? (i > 0 ? raw[i - 1].balance : r.openBal) : (i + 1 < raw.length ? raw[i + 1].balance : null);
    if (other === null) return null;
    const d = r.balance - other;
    return near(Math.abs(d), Math.abs(r.amt)) ? Math.sign(d) : null;
  };

  // Sem coluna de saldo e com as saídas marcadas com "-": um valor positivo sem sinal é uma entrada.
  const docHasNeg = raw.every((r) => r.balance === null) && raw.some((r) => r.signed && r.amt < 0);
  return raw.map((r, i) => {
    let type: 'expense' | 'income';
    const ds = deltaSign(i);
    if (r.signed) type = r.amt < 0 ? 'expense' : 'income';
    else if (ds) type = ds < 0 ? 'expense' : 'income';
    else if (docHasNeg && r.amt > 0) type = 'income';
    else type = guessIncome(r.desc) ? 'income' : 'expense';
    return { date: r.date, description: r.desc.replace(/\s*(EUR|€)\s*$/i, '').trim(), amountCents: Math.abs(r.amt), type };
  }).filter((r) => r.amountCents > 0);
}
/** Palavras que indicam salário nos extratos (PT, BR, EN, ES, FR). */
export const SALARY_WORDS = /sal[aá]rio|\bsal\b|vencimento|\bvenc\b|ordenado|remunera[cç]|payroll|salary|\bwages?\b|n[oó]mina|salaire|\bpaie\b|subs[ií]dio (de )?(f[eé]rias|natal)|13[ºo.]? ?m[eê]s/i;

/** Chave do pagador: descrição sem números, datas e palavras de transferência (para ver se o mesmo pagador se repete). */
function payerKey(desc: string): string {
  return desc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\d+/g, ' ')
    .replace(/\b(trf|transf|transferencia|transfer|sepa|inst|instantanea|de|da|do|from|p\/o|po|ref|mb way|mbway|cred|credito|ordem|deposito)\b/g, ' ')
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}

/**
 * Quais linhas de rendimento são salário: pelas palavras (SALARY_WORDS) ou porque o mesmo pagador paga
 * um valor parecido (±25%) em 2+ meses diferentes, com valor ≥ minCents (por omissão 300).
 */
export function detectSalaryRows(rows: Array<{ date: string; description: string; amountCents: number; type: 'expense' | 'income' }>, minCents = 30000): Set<number> {
  const out = new Set<number>();
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.type !== 'income') return;
    if (SALARY_WORDS.test(r.description)) { out.add(i); return; }
    const k = payerKey(r.description);
    if (k.length >= 3) groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  for (const idx of groups.values()) {
    const big = idx.filter((i) => rows[i].amountCents >= minCents);
    const months = new Set(big.map((i) => rows[i].date.slice(0, 7)));
    if (months.size < 2 || big.length > months.size * 2) continue; // muitos pagamentos por mês: não é salário
    const sorted = big.map((i) => rows[i].amountCents).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const i of big) if (Math.abs(rows[i].amountCents - median) <= median * 0.25) out.add(i);
  }
  return out;
}

function guessIncome(desc: string): boolean {
  if (SALARY_WORDS.test(desc)) return true;
  return /sal[aá]rio|vencimento|ordenado|transf.*(rec|cr[eé]dito)|reembolso|devolu|payroll|salary|refund|dep[oó]sito|gehalt|lohn|salaire|virement re[cç]u|received|incoming|recebid|bizum de/i.test(desc);
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
    const byY = new Map<number, Array<{ x: number; w: number; s: string }>>();
    for (const it of content.items as Array<{ str: string; transform: number[]; width?: number }>) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...byY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      byY.set(key, [...(byY.get(key) ?? []), { x: it.transform[4], w: it.width ?? 0, s: it.str }]);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      // pedaços colados (mesma frase) juntam-se com um espaço; colunas diferentes com dois
      const parts = byY.get(y)!.sort((a, b) => a.x - b.x);
      let line = '';
      parts.forEach((p2, i) => {
        if (i === 0) { line = p2.s; return; }
        const prev = parts[i - 1];
        const gap = prev.w ? p2.x - (prev.x + prev.w) : 99;
        line += (gap < 4 ? ' ' : '  ') + p2.s;
      });
      lines.push(line);
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
  [SALARY_WORDS, 'catSalary'],
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
