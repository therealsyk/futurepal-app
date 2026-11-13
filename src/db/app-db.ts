import { createDatabase } from './database';

// Single shared DB instance for the running app (browser IndexedDB).
export const db = createDatabase('wallet');
