import { describe, it, expect } from 'vitest';
import { changedSince, mergeRows, buildPushPayload, applyRemote } from './sync';

type Row = { id: string; updatedAt: string; deletedAt: string | null };

const row = (id: string, updatedAt: string, deletedAt: string | null = null): Row => ({ id, updatedAt, deletedAt });

describe('sync helpers', () => {
  it('changedSince returns everything when there is no lastSync', () => {
    const rows = [row('a', '2026-01-01T00:00:00.000Z'), row('b', '2026-01-02T00:00:00.000Z')];
    expect(changedSince(rows, null)).toHaveLength(2);
  });

  it('changedSince filters rows older than lastSync and keeps soft-deleted changes', () => {
    const rows = [
      row('a', '2026-01-01T00:00:00.000Z'),
      row('b', '2026-02-01T00:00:00.000Z'),
      row('c', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'), // soft-deleted but changed
    ];
    const dirty = changedSince(rows, '2026-01-31T00:00:00.000Z');
    expect(dirty.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('mergeRows keeps the newer updatedAt for each id (remote wins if newer)', () => {
    const local = [row('a', '2026-01-01T00:00:00.000Z')];
    const remote = [row('a', '2026-02-01T00:00:00.000Z'), row('b', '2026-02-05T00:00:00.000Z')];
    const merged = mergeRows(local, remote);
    expect(merged.find((r) => r.id === 'a')!.updatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('mergeRows is local-first on ties (does not overwrite with equal timestamps)', () => {
    const local = [row('a', '2026-01-01T00:00:00.000Z', null)];
    const remote = [row('a', '2026-01-01T00:00:00.000Z', 'deleted')];
    const merged = mergeRows(local, remote);
    expect(merged.find((r) => r.id === 'a')!.deletedAt).toBeNull(); // local wins on tie
  });

  it('buildPushPayload attaches user_id and only dirty rows', () => {
    const rows = [row('a', '2026-01-01T00:00:00.000Z'), row('b', '2026-05-01T00:00:00.000Z')];
    const payload = buildPushPayload('transactions', rows, '2026-04-01T00:00:00.000Z', 'user-1');
    expect(payload.table).toBe('transactions');
    expect(payload.rows.map((r) => r.id)).toEqual(['b']);
    expect(payload.rows[0].user_id).toBe('user-1');
  });

  it('applyRemote merges two devices simulating a real sync round-trip', () => {
    // Device A local state.
    const deviceA = [row('t1', '2026-01-01T00:00:00.000Z'), row('t2', '2026-01-02T00:00:00.000Z')];
    // Remote (device B) sent newer edits for t1 and a brand-new t3.
    const remote = [row('t1', '2026-01-05T00:00:00.000Z'), row('t3', '2026-01-04T00:00:00.000Z')];
    const result = applyRemote(deviceA, remote);
    expect(result.find((r) => r.id === 't1')!.updatedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(result.map((r) => r.id).sort()).toEqual(['t1', 't2', 't3']);
  });
});
