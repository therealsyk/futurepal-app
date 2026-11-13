// Pure logic: app settings (language, country, currency, theme) persisted in localStorage.
import i18n from 'i18next';
import { getCountry } from './locale';

export interface AppSettings {
  language: string; // pt-PT | pt-BR | en | es | fr
  country: string; // ISO alpha-2, empty until chosen in the wizard
  currency: string; // ISO 4217 main currency
  theme: 'dark' | 'light';
}

const STORAGE_KEY = 'wallet.settings';

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'pt-PT',
  country: '',
  currency: 'EUR',
  theme: 'dark',
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private mode); keep in-memory only.
  }
}

// Maps app language keys to BCP-47 locales used by Intl.
export function localeForLanguage(language: string): string {
  return language; // pt-PT, pt-BR, en, es, fr are valid Intl locales ('en' defaults to en-US)
}

export function applyLanguage(language: string): void {
  i18n.changeLanguage(language);
}

// When the country changes, update currency/language defaults from locale.ts.
export function applyCountry(settings: AppSettings, countryCode: string): AppSettings {
  const info = getCountry(countryCode);
  if (!info) return settings;
  const next: AppSettings = { ...settings, country: info.code, currency: info.currency };
  // Only auto-switch language if the user has not explicitly picked one yet (wizard flow).
  if (!settings.language || settings.language === DEFAULT_SETTINGS.language) {
    const supported = ['pt-PT', 'pt-BR', 'en', 'es', 'fr'];
    if (supported.includes(info.language)) next.language = info.language;
  }
  return next;
}

export function setTheme(theme: 'dark' | 'light'): void {
  try {
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // No DOM in tests.
  }
}
