import type { WalletDB } from '../db/database';
import type { Transaction, Salary } from '../db/database';
import XLSX from 'xlsx';

// SPEC §6.10: export/import JSON backup. Export all active records (no soft-deleted).
export interface BackupData {
  version: number;
  exportedAt: string;
  transactions: Transaction[];
  salaries: Salary[];
}

export async function exportBackup(db: WalletDB): Promise<BackupData> {
  const [transactions, salaries] = await Promise.all([
    db.transactions.filter((t) => t.deletedAt === null).toArray(),
    db.salaries.filter((s) => s.deletedAt === null).toArray(),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), transactions, salaries };
}

export async function importBackup(db: WalletDB, data: BackupData): Promise<number> {
  let count = 0;
  for (const t of data.transactions) {
    await db.transactions.put(t);
    count++;
  }
  for (const s of data.salaries) {
    await db.salaries.put(s);
    count++;
  }
  return count;
}

// SPEC §8: import the user's Excel. Sheet "Registo" columns: date, description, amount, category.
// Returns parsed transactions ready to insert (preview before commit).
export interface ParsedExcelRow {
  date: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // always positive
  type: 'expense' | 'income';
  category: string;
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    // Use local date parts to avoid timezone drift from toISOString.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') {
    // Excel serial date. Round to whole days to avoid timezone drift from fractional serials.
    const days = Math.round(value - 25569);
    const d = new Date(days * 86400 * 1000);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  if (typeof value === 'string') {
    const m = value.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Math.round(Math.abs(value) * 100);
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.,-]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.abs(n) * 100);
  }
  return null;
}

export function parseExcelBuffer(buffer: Buffer): ParsedExcelRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n: string) => n.toLowerCase() === 'registo') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: ParsedExcelRow[] = [];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  for (const row of data) {
    if (!row || row.length < 4) continue;
    const date = parseDate(row[0]);
    const description = String(row[1] ?? '').trim();
    const amountCents = parseAmount(row[2]);
    const category = String(row[3] ?? 'Outros').trim() || 'Outros';
    if (!date || !description || amountCents === null || amountCents <= 0) continue;
    rows.push({ date, description, amountCents, type: 'expense', category });
  }
  return rows;
}

// Commit previewed rows into the DB, creating categories as needed.
export async function commitExcelRows(
  db: WalletDB,
  rows: ParsedExcelRow[],
): Promise<number> {
  const existingCats = await db.categories.toArray();
  const catByName = new Map(existingCats.map((c) => [c.name.toLowerCase(), c.id]));
  let count = 0;
  for (const r of rows) {
    let categoryId = catByName.get(r.category.toLowerCase());
    if (!categoryId) {
      const cat = await db.categories.add({
        id: crypto.randomUUID(),
        name: r.category,
        color: '#888',
        icon: 'tag',
        order: existingCats.length + count,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      } as any);
      categoryId = String(cat);
    }
    await db.transactions.add({
      id: crypto.randomUUID(),
      date: r.date,
      type: r.type,
      categoryId,
      description: r.description,
      amountCents: r.amountCents,
      currency: 'EUR',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    } as any);
    count++;
  }
  return count;
}
