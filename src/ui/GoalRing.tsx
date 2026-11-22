import type { CSSProperties, ReactNode } from 'react';

/** Anel que se enche até à percentagem da meta. */
export function GoalRing({ r, size, debt, tone, children }: { r: number; size: number; debt?: boolean; tone?: string; children?: ReactNode }) {
  const done = r >= 1;
  return (
    <span className={'gl-ring' + (tone !== undefined ? ' ' + tone : done ? ' done' : debt ? ' debt' : '')} style={{ width: size, height: size, '--p': r * 100 } as CSSProperties}>
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="43" />{r > 0.005 && <circle className="on" cx="50" cy="50" r="43" pathLength={100} />}</svg>
      <span className="gl-ring-in">{children ?? <b>{done ? '✓' : `${Math.round(r * 100)}%`}</b>}</span>
    </span>
  );
}
