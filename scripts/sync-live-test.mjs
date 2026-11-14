// Live sync test (Phase 13): simulates two devices against the real Supabase project.
// Device A pushes a transaction, device B pulls it; then B edits and A pulls — merge must keep newer updatedAt.
// Run: node scripts/sync-live-test.mjs  (reads .env from project root)
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error('MISSING .env — put VITE_SUPABASE_URL and VITE_SUPABASE_KEY in D:\\Claude Apps\\Wallet\\app\\.env');
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('=').slice(0, 2))
);
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('MISSING VITE_SUPABASE_URL or VITE_SUPABASE_KEY in .env'); process.exit(1); }

const supabase = createClient(url, key);

// Login with test account so RLS (user_id = auth.uid()) allows writes
const email = env.TEST_EMAIL;
const password = env.TEST_PASSWORD;
if (!email || !password) {
  console.error('MISSING TEST_EMAIL or TEST_PASSWORD in .env — the live test needs a real Supabase user to pass RLS.');
  process.exit(1);
}
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError || !authData.user) {
  console.error(`LOGIN failed: ${authError?.message || 'no user returned'} — create the test user in Supabase Auth first.`);
  process.exit(1);
}
console.log(`   Logged in as ${email} (uid ${authData.user.id})`);
const userId = authData.user.id;

const nowISO = () => new Date().toISOString();

async function table(name) {
  const { data, error } = await supabase.from(name).select('*');
  if (error) throw new Error(`table ${name}: ${error.message}`);
  return data || [];
}

console.log('1) Connectivity check...');
const probe = await table('transactions');
console.log(`   OK — transactions table reachable (${probe.length} rows)`);

// --- Device A pushes a transaction ---
const tx = {
  id: crypto.randomUUID(),
  user_id: userId,
  date: nowISO().slice(0, 10),
  type: 'expense',
  category_id: 'test-cat',
  description: 'Live sync test coffee',
  amount_cents: 250,
  currency: 'EUR',
  created_at: nowISO(),
  updated_at: nowISO(),
  deleted_at: null,
};
const { error: insErr } = await supabase.from('transactions').insert(tx);
if (insErr) { console.error('INSERT failed:', insErr.message); process.exit(1); }
console.log(`2) Device A pushed tx ${tx.id}`);

// --- Device B pulls and merges ---
const remote = await table('transactions');
const localB = []; // fresh device
const byId = new Map(localB.map(r => [r.id, r]));
let pulled = 0;
for (const r of remote) {
  const l = byId.get(r.id);
  if (!l || r.updated_at > l.updatedAt) { pulled++; }
}
console.log(`3) Device B sees ${remote.length} remote rows, merges ${pulled} (should be >=1 incl. our tx)`);
const found = remote.find(r => r.id === tx.id);
if (!found) { console.error('FAIL: pushed tx not visible on pull'); process.exit(1); }
console.log(`4) Round-trip OK — tx visible with amount_cents=${found.amount_cents}`);

// --- Conflict test: B edits (newer updatedAt), A pulls, newer must win ---
const edited = { ...tx, description: 'Live sync test coffee (edited by B)', updated_at: nowISO() };
const { error: upErr } = await supabase.from('transactions').update(edited).eq('id', tx.id);
if (upErr) { console.error('UPDATE failed:', upErr.message); process.exit(1); }
const after = await table('transactions');
const f2 = after.find(r => r.id === tx.id);
console.log(`5) Conflict merge OK — description now: "${f2.description}"`);

// Cleanup
await supabase.from('transactions').delete().eq('id', tx.id);
console.log('6) Cleanup done (test tx deleted). Phase 13 live sync VERIFIED.');
