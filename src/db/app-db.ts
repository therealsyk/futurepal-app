import { createDatabase } from './database';

// Single shared DB instance for the running app (browser IndexedDB).
export const db = createDatabase('wallet');
// Dev/test hook so Playwright can seed data; only exposed in dev builds.
if (import.meta.env.DEV) (window as any).__walletDb = db;
