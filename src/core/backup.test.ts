import 'fake-indexeddb/auto';
import { describe, it, beforeEach, expect } from 'vitest';
import { createDatabase, stampNew } from '../db/database';
import type { WalletDB, Category } from '../db/database';
import { addTransaction, ensureDefaultCategories } from './finance';
import { exportBackup, importBackup, parseExcelBuffer, commitExcelRows } from './backup';

let db: WalletDB;

async function makeCategory(name: string): Promise<Category> {
  const cat = stampNew<Category>({ name, color: '#000', icon: '', order: 0 });
  await db.categories.add(cat);
  return cat;
}

beforeEach(async () => {
  db = createDatabase('backup-' + Math.random().toString(36).slice(2));
  await db.settings.clear();
  await db.categories.clear();
  await db.transactions.clear();
  await db.salaries.clear();
});

describe('JSON backup (SPEC §6.10)', () => {
  it('export returns only active records', async () => {
    const cat = await makeCategory('Casa');
    await addTransaction(db, { date: '2026-01-10', type: 'expense', categoryId: cat.id, description: 'Luz', amountCents: 5000, currency: 'EUR' });
    const t = await db.transactions.toArray();
    await db.transactions.update(t[0].id, { deletedAt: new Date().toISOString() });
    await addTransaction(db, { date: '2026-01-11', type: 'expense', categoryId: cat.id, description: 'Agua', amountCents: 3000, currency: 'EUR' });

    const backup = await exportBackup(db);
    expect(backup.version).toBe(1);
    expect(backup.transactions.length).toBe(1);
    expect(backup.transactions[0].description).toBe('Agua');
    expect(typeof backup.exportedAt).toBe('string');
  });

  it('import restores records and count matches', async () => {
    const cat = await makeCategory('Transporte');
    await addTransaction(db, { date: '2026-02-01', type: 'income', categoryId: cat.id, description: 'Salario', amountCents: 100000, currency: 'EUR' });
    const backup = await exportBackup(db);

    const db2 = createDatabase('backup-import-' + Math.random().toString(36).slice(2));
    await db2.categories.bulkAdd(await db.categories.toArray());
    const count = await importBackup(db2, backup);
    expect(count).toBe(1);
    const restored = await db2.transactions.toArray();
    expect(restored[0].description).toBe('Salario');
    expect(restored[0].amountCents).toBe(100000);
  });
});

describe('Excel import (SPEC §8)', () => {

  it('parses a synthetic workbook with Registo sheet', () => {
    // Build an in-memory workbook to test the parser deterministically.
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Data', 'Descrição', 'Valor', 'Categoria'],
      ['2026-01-15', 'Supermercado', 45.3, 'Alimentação'],
      [new Date('2026-02-03'), 'Gasolina', 30, 'Transporte'],
      ['2026-03-01', 'Renda', 800, 'Renda'],
      ['', '', '', ''], // blank row skipped
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Registo');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const rows = parseExcelBuffer(buffer);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({ date: '2026-01-15', description: 'Supermercado', amountCents: 4530, type: 'expense', category: 'Alimentação' });
    expect(rows[1].date).toBe('2026-02-03');
    expect(rows[2].amountCents).toBe(80000);
  });

  it('commitExcelRows creates categories and transactions with positive cents', async () => {
    await ensureDefaultCategories(db);
    const rows = [
      { date: '2026-04-10', description: 'Farmácia', amountCents: 2500, type: 'expense' as const, category: 'Saúde' },
      { date: '2026-04-11', description: 'Novo grupo', amountCents: 1000, type: 'expense' as const, category: 'Personalizado' },
    ];
    const count = await commitExcelRows(db, rows);
    expect(count).toBe(2);
    const txs = await db.transactions.toArray();
    expect(txs.length).toBe(2);
    expect(txs.every((t) => t.amountCents > 0)).toBe(true);
    // 'Personalizado' category should have been created on the fly.
    const cats = await db.categories.toArray();
    expect(cats.some((c) => c.name === 'Personalizado')).toBe(true);
  });
});
