// Disposição das janelas do Painel (3 colunas). Lógica pura, guardada no localStorage.
// Ids: 'goals', 'overview', … e dinâmicos 'goal:<id>' / 'account:<id>'.

export type Layout = string[][];

export const COLUMNS = 3;
// Coluna 1: o mês/ano e os detalhes; coluna 2: gráfico e calendário; coluna 3: para onde foi o dinheiro e o dia a dia
export const DEFAULT_LAYOUT: Layout = [
  ['mHero', 'rLines', 'mGoals'],
  ['overview', 'rCal'],
  ['rCats', 'mLatest', 'mGroups'],
];
// v2: disposição com os cartões da app de telemóvel (a anterior fica de lado)
const KEY = 'wallet.dashLayout.v4';

const clone = (l: Layout): Layout => l.map((c) => [...c]);

export function normalize(raw: unknown): Layout {
  if (!Array.isArray(raw) || raw.length !== COLUMNS || !raw.every((c) => Array.isArray(c) && c.every((x) => typeof x === 'string'))) {
    return clone(DEFAULT_LAYOUT);
  }
  const seen = new Set<string>();
  return (raw as string[][]).map((col) => col.filter((id) => (seen.has(id) ? false : (seen.add(id), true))));
}

// Cada modo do Painel (Mês / Ano) tem a sua disposição. A antiga (única) serve de ponto de partida aos dois.
export type LayoutMode = 'month' | 'year';
const keyFor = (mode?: LayoutMode) => (mode ? `${KEY}.${mode}` : KEY);

export function loadLayout(mode?: LayoutMode): Layout {
  try {
    const raw = localStorage.getItem(keyFor(mode)) ?? (mode ? localStorage.getItem(KEY) : null);
    return raw ? normalize(JSON.parse(raw)) : clone(DEFAULT_LAYOUT);
  } catch {
    return clone(DEFAULT_LAYOUT);
  }
}

export function saveLayout(l: Layout, mode?: LayoutMode): void {
  try { localStorage.setItem(keyFor(mode), JSON.stringify(l)); } catch { /* sem armazenamento */ }
}

// Cartões que se podem "esticar" (mostram o dobro dos itens). Guardado por modo, como a disposição.
export const STRETCHABLE = new Set(['recent', 'topExpenses', 'upcoming']);
export function loadStretched(mode: LayoutMode): string[] {
  try { const v = JSON.parse(localStorage.getItem(`${KEY}.tall.${mode}`) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export function saveStretched(ids: string[], mode: LayoutMode): void {
  try { localStorage.setItem(`${KEY}.tall.${mode}`, JSON.stringify(ids)); } catch { /* sem armazenamento */ }
}

export function placedIds(l: Layout): Set<string> {
  return new Set(l.flat());
}

// Move (ou insere) a janela `id` para a coluna `col`, antes de `beforeId` (null = no fim).
export function moveWidget(l: Layout, id: string, col: number, beforeId: string | null): Layout {
  const next = l.map((c) => c.filter((x) => x !== id));
  const target = next[col];
  const at = beforeId ? target.indexOf(beforeId) : -1;
  if (at >= 0) target.splice(at, 0, id); else target.push(id);
  return next;
}

export function removeWidget(l: Layout, id: string): Layout {
  return l.map((c) => c.filter((x) => x !== id));
}

// Nova janela: vai para o fim da coluna mais vazia (a central só em último caso).
export function addWidget(l: Layout, id: string): Layout {
  if (placedIds(l).has(id)) return l;
  const order = [0, 2, 1].sort((a, b) => l[a].length - l[b].length);
  return moveWidget(l, id, order[0], null);
}

// Teclado: ↑/↓ dentro da coluna, ←/→ para a coluna do lado.
export function nudgeWidget(l: Layout, id: string, dir: 'up' | 'down' | 'left' | 'right'): Layout {
  const col = l.findIndex((c) => c.includes(id));
  if (col < 0) return l;
  const idx = l[col].indexOf(id);
  if (dir === 'up') return idx === 0 ? l : moveWidget(l, id, col, l[col][idx - 1]);
  if (dir === 'down') return idx >= l[col].length - 1 ? l : moveWidget(l, id, col, l[col][idx + 2] ?? null);
  const to = dir === 'left' ? col - 1 : col + 1;
  if (to < 0 || to >= COLUMNS) return l;
  return moveWidget(l, id, to, l[to][idx] ?? null);
}

// Troca um widget por outro no mesmo sítio (ex.: meta em anel → meta em barra).
export function swapWidget(l: Layout, oldId: string, newId: string): Layout {
  if (oldId === newId) return l;
  return l.map((c) => c.filter((x) => x !== newId).map((x) => (x === oldId ? newId : x)));
}

export function pruneLayout(l: Layout, valid: (id: string) => boolean): Layout {
  return l.map((c) => c.filter(valid));
}
