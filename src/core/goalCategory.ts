import type { WalletDB } from '../db/database';
import { activeCategories, defaultCategoryId } from './finance';

// Categoria "Metas": faz parte do catálogo (grupo Poupança), não das categorias criadas pela pessoa.
const KEY = 'wallet.goalCat';
export const GOAL_CAT_KEY = 'catGoals';

/** Versões anteriores criavam "Metas" como categoria própria da pessoa (grupo "custom").
 *  Passa-a para o catálogo (Poupança), para "As minhas categorias" ter só o que a pessoa criou. */
export async function adoptGoalCategory(db: WalletDB): Promise<void> {
  let saved = ''; try { saved = localStorage.getItem(KEY) || ''; } catch { /* sem storage */ }
  const all = await db.categories.toArray();
  if (all.some((c) => c.nameKey === GOAL_CAT_KEY)) return;
  const old = all.find((c) => !c.nameKey && c.deletedAt === null && (c.id === saved || ((c.name === 'Metas' || c.name === 'Goals') && c.icon === 'coins' && c.color === '#17c3c9')));
  if (!old) return;
  await db.categories.put({ ...old, name: GOAL_CAT_KEY, nameKey: GOAL_CAT_KEY, group: 'savings', color: '#c2410c', updatedAt: new Date().toISOString() });
}

export async function goalCategoryId(db: WalletDB): Promise<string> {
  const hit = (await activeCategories(db)).find((c) => c.nameKey === GOAL_CAT_KEY);
  return hit?.id ?? defaultCategoryId(GOAL_CAT_KEY);
}
