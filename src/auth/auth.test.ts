import { describe, it, expect } from 'vitest';
import { canSync, hasSupabaseConfig } from './supabase';

describe('auth helpers', () => {
  it('canSync is false without a user', () => {
    expect(canSync(null)).toBe(false);
    expect(canSync({ id: undefined })).toBe(false);
  });

  it('canSync is true with a user id', () => {
    expect(canSync({ id: 'abc123' })).toBe(true);
  });

  it('hasSupabaseConfig reflects env presence (false in test env)', () => {
    // No VITE_SUPABASE_URL set during tests -> offline mode stays available.
    expect(hasSupabaseConfig()).toBe(false);
  });
});
