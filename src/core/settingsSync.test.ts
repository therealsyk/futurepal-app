import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase, stampNew, type SettingsRow } from '../db/database';
import { DEFAULT_SETTINGS, type AppSettings } from './settings';
import { mirrorSettings, getLastSync, remoteSettingsIfNewer, SETTINGS_ROW_ID } from './settingsSync';

let db = createDatabase('settings-sync-test');
const s: AppSettings = { ...DEFAULT_SETTINGS, country: 'PT', currency: 'EUR', updatedAt: '2026-11-17T10:00:00.000Z' };

beforeEach(async () => {
  await db.delete();
  db = createDatabase('settings-sync-test');
});

describe('settingsSync', () => {
  it('mirrors into one fixed row and retires old random-id rows, keeping lastSync', async () => {
    await db.settings.put(stampNew<SettingsRow>({ language: 'pt-PT', country: 'PT', mainCurrency: 'EUR', firstDayOfWeek: 1, dateFormat: 'DMY', theme: 'dark', setupDone: true, lastSync: '2026-11-16T00:00:00.000Z' }));
    await mirrorSettings(db, { ...s, currency: 'USD' });
    const rows = await db.settings.toArray();
    const active = rows.filter((r) => r.deletedAt === null);
    expect(active.map((r) => r.id)).toEqual([SETTINGS_ROW_ID]);
    expect(active[0].mainCurrency).toBe('USD');
    expect(await getLastSync(db)).toBe('2026-11-16T00:00:00.000Z');
  });

  it('does not touch the row when nothing changed (no endless re-push)', async () => {
    await mirrorSettings(db, s);
    const before = (await db.settings.get(SETTINGS_ROW_ID))!.updatedAt;
    await mirrorSettings(db, { ...s, updatedAt: undefined });
    expect((await db.settings.get(SETTINGS_ROW_ID))!.updatedAt).toBe(before);
  });

  it('applies the remote row only when it is newer than the local settings', async () => {
    await mirrorSettings(db, s);
    expect(await remoteSettingsIfNewer(db, s)).toBeNull();
    await db.settings.update(SETTINGS_ROW_ID, { theme: 'light', updatedAt: '2026-11-18T00:00:00.000Z' });
    const next = await remoteSettingsIfNewer(db, s);
    expect(next?.theme).toBe('light');
    expect(next?.updatedAt).toBe('2026-11-18T00:00:00.000Z');
  });
});
