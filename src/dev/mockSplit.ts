// SÓ EM DESENVOLVIMENTO (preview): simula uma sessão iniciada e um grupo de despesas partilhadas,
// sem falar com o servidor. Liga-se com localStorage 'wallet:mock-split' = '1' (desliga-se apagando a chave).
// Todos os pedidos ao Supabase são respondidos aqui (nada sai do browser) e os dados ficam no localStorage.

const ON_KEY = 'wallet:mock-split';
const DB_KEY = 'wallet:mock-split-db';
const ME = '11111111-1111-4111-8111-111111111111';
const ANA = '22222222-2222-4222-8222-222222222222';
const BRUNO = '33333333-3333-4333-8333-333333333333';
const CARLA = '44444444-4444-4444-8444-444444444444';
const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);
const uuid = () => crypto.randomUUID();

function seed(): Store {
  const people = [ME, ANA, BRUNO, CARLA];
  const bills: Array<[string, number, number, string, string[]]> = [
    // descrição, valor (cêntimos), há quantos dias, quem criou, quem já pagou
    ['🏨 Alojamento (3 noites)', 48000, 12, ME, [ME, ANA, BRUNO]],
    ['🚗 Aluguer de carro', 16000, 11, ANA, [ANA, ME]],
    ['🍽️ Jantar em Alfama', 9640, 10, BRUNO, [BRUNO]],
    ['⛽ Gasolina', 6200, 9, ME, [ME]],
    ['🎟️ Bilhetes do museu', 4800, 8, CARLA, [CARLA, ME, ANA, BRUNO]],
    ['🛒 Supermercado', 7355, 7, ANA, [ANA]],
  ];
  const split_bills: Row[] = [], split_shares: Row[] = [];
  for (const [description, amount, ago, by, paid] of bills) {
    const id = uuid();
    split_bills.push({ id, group_id: G, description, amount_cents: amount, date: day(ago), created_by: by, created_at: iso(ago), deleted_at: null });
    const each = Math.floor(amount / people.length);
    people.forEach((u, i) => split_shares.push({ bill_id: id, user_id: u, share_cents: i === 0 ? amount - each * 3 : each, paid_at: paid.includes(u) ? iso(ago - 1) : null, marked_by: null }));
  }
  return {
    split_groups: [{ id: G, name: 'Viagem a Lisboa', owner_id: ME, currency: 'EUR', created_at: iso(14), color: '#17c3c9', image: null }],
    split_members: [
      { group_id: G, user_id: ME, display_name: 'Tu', joined_at: iso(14), can_edit: true, avatar_url: null },
      { group_id: G, user_id: ANA, display_name: 'Ana', joined_at: iso(13), can_edit: true, avatar_url: null },
      { group_id: G, user_id: BRUNO, display_name: 'Bruno', joined_at: iso(13), can_edit: false, avatar_url: null },
      { group_id: G, user_id: CARLA, display_name: 'Carla', joined_at: iso(12), can_edit: false, avatar_url: null },
    ],
    split_invites: [{ id: uuid(), group_id: G, email: 'diogo@exemplo.test', phone: null, invited_by: ME, status: 'pending', created_at: iso(2) }],
    split_bills, split_shares,
  };
}

function load(): Store { try { const s = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); if (s) return s; } catch { /* volta a criar */ } const s = seed(); save(s); return s; }
function save(s: Store) { try { localStorage.setItem(DB_KEY, JSON.stringify(s)); } catch { /* sem storage */ } }

// filtros do PostgREST: eq, neq, is, in, gt, gte, lt, lte
function match(r: Row, params: URLSearchParams): boolean {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const dot = raw.indexOf('.'), op = raw.slice(0, dot), v = raw.slice(dot + 1), cur = r[k];
    const s = cur === null || cur === undefined ? null : String(cur);
    if (op === 'eq' && s !== v) return false;
    if (op === 'neq' && s === v) return false;
    if (op === 'is' && !((v === 'null' && s === null) || (v === 'true' && cur === true) || (v === 'false' && cur === false))) return false;
    if (op === 'in' && !v.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(s ?? '')) return false;
    if (op === 'gt' && !(s !== null && s > v)) return false;
    if (op === 'gte' && !(s !== null && s >= v)) return false;
    if (op === 'lt' && !(s !== null && s < v)) return false;
    if (op === 'lte' && !(s !== null && s <= v)) return false;
  }
  return true;
}

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/*' } });

const USER = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'tu@exemplo.test', email_confirmed_at: iso(30), phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { name: 'Tu' }, identities: [], created_at: iso(30), updated_at: iso(1) };
const session = () => ({ access_token: 'mock-access-token', token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, refresh_token: 'mock-refresh', user: USER });

async function handle(url: URL, init: RequestInit | undefined, req: Request | null): Promise<Response> {
  const method = (init?.method || req?.method || 'GET').toUpperCase();
  const path = url.pathname;
  const headers = new Headers(init?.headers || req?.headers);
  const bodyText = init?.body ? String(init.body) : req ? await req.clone().text() : '';
  const body = bodyText ? (() => { try { return JSON.parse(bodyText); } catch { return null; } })() : null;
  if (path.startsWith('/auth/v1/user')) return json(USER);
  if (path.startsWith('/auth/v1/token')) return json(session());
  if (path.startsWith('/auth/v1/logout')) { localStorage.removeItem(ON_KEY); return json({}, 204); }
  if (path.startsWith('/auth/v1/')) return json({});
  const db = load();
  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = path.slice('/rest/v1/rpc/'.length);
    if (fn === 'set_split_paid' && body) {
      const sh = (db.split_shares ?? []).find((x) => x.bill_id === body.p_bill && x.user_id === body.p_user);
      if (sh) { sh.paid_at = body.p_paid ? new Date().toISOString() : null; sh.marked_by = ME; save(db); }
    }
    if (fn === 'close_split_group' && body) {
      const g = (db.split_groups ?? []).find((x) => x.id === body.p_group);
      if (g) { g.closed_at = body.p_closed ? (g.closed_at ?? new Date().toISOString()) : null; save(db); }
    }
    return json(null);
  }
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length), rows = (db[table] ??= []);
    const one = (headers.get('Accept') || '').includes('vnd.pgrst.object');
    if (method === 'GET' || method === 'HEAD') {
      let out = rows.filter((r) => match(r, url.searchParams));
      const ord = url.searchParams.get('order');
      if (ord) { const [col, dir] = ord.split(',')[0].split('.'); out = [...out].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (dir === 'desc' ? -1 : 1)); }
      const lim = Number(url.searchParams.get('limit') || 0); if (lim) out = out.slice(0, lim);
      return one ? (out[0] ? json(out[0]) : json(null, 406)) : json(out);
    }
    if (method === 'POST') {
      const add = (Array.isArray(body) ? body : body ? [body] : []).map((r: Row) => ({ id: uuid(), created_at: new Date().toISOString(), ...r }));
      if (table.startsWith('split_')) { rows.push(...add); save(db); }
      return json(one ? add[0] ?? null : add, 201);
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => match(r, url.searchParams)); for (const r of hit) Object.assign(r, body);
      if (table.startsWith('split_')) save(db);
      return json(one ? hit[0] ?? null : hit);
    }
    if (method === 'DELETE') { db[table] = rows.filter((r) => !match(r, url.searchParams)); save(db); return json([]); }
  }
  return json({}); // storage, functions, etc.
}

export function setupMockSplit(supabaseUrl: string) {
  if (!import.meta.env.DEV || !supabaseUrl) return;
  let on = false; try { on = localStorage.getItem(ON_KEY) === '1'; } catch { /* sem storage */ }
  if (!on) { // simulação desligada: a conta falsa não pode ficar na lista de contas (a app tentaria repor a sessão)
    try { const k = 'wallet.savedAccounts', v = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(v) && v.some((a) => a?.id === ME)) localStorage.setItem(k, JSON.stringify(v.filter((a) => a?.id !== ME))); } catch { /* sem storage */ }
    return;
  }
  const base = new URL(supabaseUrl), ref = base.hostname.split('.')[0];
  try { localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session())); } catch { /* sem storage */ }
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), location.href);
    if (url.host === base.host) return handle(url, init, req);
    return real(input, init);
  };
  // tempo real: não liga ao servidor
  const RealWS = window.WebSocket;
  window.WebSocket = function (this: unknown, u: string | URL, p?: string | string[]) {
    if (new URL(String(u)).host === base.host) return { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {}, onopen: null, onclose: null, onerror: null, onmessage: null } as unknown as WebSocket;
    return new RealWS(u, p);
  } as unknown as typeof WebSocket;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  console.info('[mock-split] sessão simulada e grupo "Viagem a Lisboa" (só nesta preview)');
}
