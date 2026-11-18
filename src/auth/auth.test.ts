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
describe('normalizePhone', () => {
  it('normalizes Portuguese and international numbers', () => {
    expect(normalizePhone('912 345 678')).toBe('351912345678');
    expect(normalizePhone('+351 912 345 678')).toBe('351912345678');
    expect(normalizePhone('0044 7700 900123')).toBe('447700900123');
    expect(normalizePhone('123')).toBeNull();
  });
});
