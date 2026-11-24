import type { Goal } from '../db/database';

/** Dinheiro reservado em metas, por conta: continua na conta, mas está guardado para a meta e não conta no saldo disponível.
 *  Usa a conta de cada registo; sem ela, a primeira conta escolhida na meta. */
export function reservedByAccount(goals: Goal[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of goals) {
    if (g.deletedAt) continue;
    for (const c of g.contributions ?? []) {
      const acc = c.accountId ?? g.accountIds?.[0];
      if (!acc) continue;
      m.set(acc, (m.get(acc) ?? 0) + c.cents);
    }
  }
  for (const [k, v] of m) if (v <= 0) m.delete(k);
  return m;
}
