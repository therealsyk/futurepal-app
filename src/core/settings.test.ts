import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, applyCountry, localeForLanguage } from './settings';

describe('settings', () => {
  it('applyCountry sets currency and auto-picks language for a new country', () => {
    const next = applyCountry({ ...DEFAULT_SETTINGS }, 'BR');
    expect(next.country).toBe('BR');
    expect(next.currency).toBe('BRL');
    expect(next.language).toBe('pt-BR');
  });

  it('applyCountry keeps an explicitly chosen language', () => {
    const base = { ...DEFAULT_SETTINGS, language: 'en' };
    const next = applyCountry(base, 'PT');
    expect(next.currency).toBe('EUR');
    expect(next.language).toBe('en'); // user already chose English
  });

  it('unknown country leaves settings unchanged', () => {
    const next = applyCountry({ ...DEFAULT_SETTINGS }, 'ZZ');
    expect(next.country).toBe('');
  });

  it('localeForLanguage passes through valid Intl locales', () => {
    expect(localeForLanguage('pt-PT')).toBe('pt-PT');
    expect(localeForLanguage('en')).toBe('en');
  });
});
