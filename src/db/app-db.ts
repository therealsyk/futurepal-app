import { createDatabase } from './database';

// Single shared DB instance for the running app (browser IndexedDB).
export const db = createDatabase('wallet');
// Dev/test hook so Playwright can seed data; harmless in production.
(window as any).__walletDb = db;
