import { describe, it, expect } from 'vitest';
import { canSync, authErrorKey } from './supabase';

describe('auth helpers', () => {
  it('canSync is false without a user', () => {
    expect(canSync(null)).toBe(false);
    expect(canSync({ id: undefined })).toBe(false);
  });

  it('canSync is true with a user id', () => {
    expect(canSync({ id: 'abc123' })).toBe(true);
  });

  it('maps Supabase errors to i18n keys', () => {
    expect(authErrorKey({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('auth.err_invalid');
    expect(authErrorKey({ message: 'Email not confirmed' })).toBe('auth.err_notConfirmed');
    expect(authErrorKey({ code: 'user_already_exists' })).toBe('auth.err_exists');
    expect(authErrorKey({ code: 'weak_password' })).toBe('auth.err_weak');
    expect(authErrorKey(new Error('Failed to fetch'))).toBe('auth.err_network');
    expect(authErrorKey(new Error('not-configured'))).toBe('auth.err_notConfigured');
    expect(authErrorKey('???')).toBe('auth.err_generic');
  });
});

import { normalizePhone } from './supabase';
import { rememberSession, savedAccounts, switchToAccount, forgetAccount } from './savedAccounts';

// Minimal localStorage for these tests (vitest node env has none).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;

// Fake Supabase client (no network) to test the session-restore path used after an app update.
function fakeSb(valid: boolean) {
  const session = { access_token: 'tok', refresh_token: 'ref', user: { id: 'u1', email: 'a@b.com', user_metadata: { name: 'Ana' } } };
  return {
    auth: {
      setSession: async () => valid ? { data: { session }, error: null } : { data: { session: null }, error: new Error('invalid') },
      getSession: async () => ({ data: { session } }),
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('savedAccounts session restore', () => {
  it('rememberSession stores the most recently used account first', () => {
    localStorage.clear();
    rememberSession({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', email: 'u1@x.com', user_metadata: {} } } as never);
    rememberSession({ access_token: 'a2', refresh_token: 'r2', user: { id: 'u2', email: 'u2@x.com', user_metadata: {} } } as never);
    const list = savedAccounts();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('u2');
  });

  it('switchToAccount restores a valid saved session and drops an expired one', async () => {
    localStorage.clear();
    rememberSession({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', email: 'u1@x.com', user_metadata: {} } } as never);
    expect(await switchToAccount(fakeSb(true), 'u1')).toBe(true);
    expect(await switchToAccount(fakeSb(false), 'u1')).toBe(false);
    expect(savedAccounts().find((a) => a.id === 'u1')).toBeUndefined();
  });

  it('forgetAccount removes an entry', () => {
    localStorage.clear();
    rememberSession({ access_token: 'a3', refresh_token: 'r3', user: { id: 'u3', email: 'u3@x.com', user_metadata: {} } } as never);
    forgetAccount('u3');
    expect(savedAccounts().length).toBe(0);
  });
});
describe('normalizePhone', () => {
  it('normalizes Portuguese and international numbers', () => {
    expect(normalizePhone('912 345 678')).toBe('351912345678');
    expect(normalizePhone('+351 912 345 678')).toBe('351912345678');
    expect(normalizePhone('0044 7700 900123')).toBe('447700900123');
    expect(normalizePhone('123')).toBeNull();
  });
});
