import 'fake-indexeddb/auto';
import { describe, it, beforeEach, expect } from 'vitest';
import { createDatabase, stampNew } from '../db/database';
import type { WalletDB, Category, Goal, Group } from '../db/database';
import { addTransaction, ensureDefaultCategories, setBudget, addRecurring, transactionsInGroup } from './finance';
import { exportBackup, importBackup, parseExcelBuffer, commitExcelRows, type BackupData } from './backup';

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
    expect(backup.version).toBe(2);
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
    expect(count).toBe(backup.transactions.length + backup.categories.length);
    const restored = await db2.transactions.toArray();
    expect(restored[0].description).toBe('Salario');
    expect(restored[0].amountCents).toBe(100000);
  });

  it('export includes categories, budgets, goals, recurrings and groups (SPEC §6.10)', async () => {
    await ensureDefaultCategories(db);
    const cats = await db.categories.toArray();
    const catId = cats[0].id;

    await setBudget(db, catId, 80000, 2026, 11);
    await db.goals.put(stampNew<Goal>({ name: 'Fundo de emergência', targetCents: 500000, currentCents: 120000, startDate: '2026-01-01', targetDate: '2026-12-31' }));
    await addRecurring(db, { description: 'Netflix', amountCents: 1399, type: 'expense', categoryId: catId, currency: 'EUR', frequency: 'monthly', nextDate: '2026-11-01' });
    const grp = stampNew<Group>({ name: 'Viagem ao Japão', color: '#4f8cff' });
    await db.groups.put(grp);
    await addTransaction(db, { date: '2026-06-01', type: 'expense', categoryId: catId, description: 'Bilhetes', amountCents: 90000, currency: 'EUR', groupId: grp.id });

    const backup = await exportBackup(db);
    expect(backup.version).toBe(2);
    expect(backup.categories.length).toBeGreaterThan(0);
    expect(backup.budgets.length).toBeGreaterThanOrEqual(1);
    expect(backup.goals.length).toBe(1);
    expect(backup.recurrings.length).toBe(1);
    expect(backup.groups.length).toBe(1);

    const db2 = createDatabase('backup-full-' + Math.random().toString(36).slice(2));
    const count = await importBackup(db2, backup);
    expect(count).toBe(backup.transactions.length + backup.salaries.length + backup.categories.length + backup.budgets.length + backup.goals.length + backup.recurrings.length + backup.groups.length);
    const budget = (await db2.budgets.toArray()).find((b) => b.categoryId === catId);
    expect(budget?.limitCents).toBe(80000);
    expect((await db2.goals.toArray())[0].targetCents).toBe(500000);

    expect((await db2.recurrings.toArray())[0].frequency).toBe('monthly');
    const grpTx = await transactionsInGroup(db2, backup.groups[0].id);
    expect(grpTx[0].description).toBe('Bilhetes');
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

  it('Settings UI round-trip: export -> JSON string -> parse -> import restores records', async () => {
    // Mirrors exactly what Settings.tsx does: JSON.stringify(exportBackup) then JSON.parse before importBackup.
    const cat = await makeCategory('Casa');
    await addTransaction(db, { date: '2026-05-01', type: 'expense', categoryId: cat.id, description: 'Internet', amountCents: 3500, currency: 'EUR' });
    const json = JSON.stringify(await exportBackup(db)); // Blob content in the UI
    const parsed: BackupData = JSON.parse(json);
    const db2 = createDatabase('backup-ui-' + Math.random().toString(36).slice(2));
    await db2.categories.bulkAdd(await db.categories.toArray());
    const count = await importBackup(db2, parsed);
    expect(count).toBe(parsed.transactions.length + (parsed.categories?.length ?? 0));
    const restored = await db2.transactions.toArray();
    expect(restored[0].description).toBe('Internet');
    expect(restored[0].amountCents).toBe(3500);
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
