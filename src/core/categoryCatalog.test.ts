import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { CATALOG_ITEMS, CAT_ICONS, CATEGORY_GROUPS, GROUP_ORDER } from './categoryCatalog';
import { addMissingCatalogCategories, ensureDefaultCategories, activeCategories, softDelete } from './finance';
import { createDatabase } from '../db/database';
import ptPT from '../i18n/pt-PT.json';
import en from '../i18n/en.json';

describe('category catalog', () => {
  it('every item has an icon and a translation in pt-PT and en; keys are unique', () => {
    const keys = CATALOG_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const it of CATALOG_ITEMS) {
      expect(CAT_ICONS[it.icon], it.key).toBeTruthy();
      expect((ptPT.categories as Record<string, string>)[it.key], it.key).toBeTruthy();
      expect((en.categories as Record<string, string>)[it.key], it.key).toBeTruthy();
    }
    for (const g of GROUP_ORDER) expect((ptPT.categoryGroups as Record<string, string>)[g], g).toBeTruthy();
    expect(CATEGORY_GROUPS.length).toBeGreaterThan(5);
  });

  it('new install gets the whole catalog; old installs get only what is missing; deleted ones stay deleted', async () => {
    const db = createDatabase('catalog-test-' + Math.random());
    await ensureDefaultCategories(db);
    expect((await activeCategories(db)).length).toBe(CATALOG_ITEMS.length);
    expect(await addMissingCatalogCategories(db)).toBe(0); // nada em falta

    const coffee = (await activeCategories(db)).find((c) => c.nameKey === 'catCoffee')!;
    await softDelete(db, 'categories', coffee.id);
    expect(await addMissingCatalogCategories(db)).toBe(0); // apagada de propósito: não volta
    expect((await activeCategories(db)).some((c) => c.nameKey === 'catCoffee')).toBe(false);
  });
});
