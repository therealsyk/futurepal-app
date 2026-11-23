import type { Goal } from '../db/database';

/** A meta está em pausa nesse dia? (sem data = até a pessoa a retomar; com data = até esse dia, inclusive) */
export function isGoalPaused(g: Pick<Goal, 'paused'>, onDay: string = new Date().toISOString().slice(0, 10)): boolean {
  if (!g.paused) return false;
  return !g.paused.until || g.paused.until >= onDay;
}
