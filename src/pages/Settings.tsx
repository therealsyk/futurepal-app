import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageTitle } from './index';
import { COUNTRIES, countryName } from '../core/locale';
import { loadSettings, saveSettings, setTheme, type AppSettings } from '../core/settings';
import { hasSupabaseConfig } from '../auth/supabase';

const LANGUAGES = [
  { code: 'pt-PT', label: 'Português (Portugal)' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

export function Settings() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>(loadSettings());

  function update(next: AppSettings) {
    setSettings(next);
    saveSettings(next);
  }

  function changeLanguage(code: string) {
    update({ ...settings, language: code });
    i18n.changeLanguage(code);
  }

  function changeCountry(code: string) {
    const info = COUNTRIES.find((c) => c.code === code);
    update({ ...settings, country: code, currency: info ? info.currency : settings.currency });
  }

  function changeCurrency(code: string) {
    update({ ...settings, currency: code });
  }

  function changeTheme(theme: 'dark' | 'light') {
    update({ ...settings, theme });
    setTheme(theme);
  }

  return (
    <div>
      <PageTitle titleKey="settings.title" />

      <label htmlFor="settings-language">{t('settings.language')}</label>
      <select id="settings-language" value={settings.language} onChange={(e) => changeLanguage(e.target.value)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>

      <label htmlFor="settings-country">{t('settings.country')}</label>
      <select id="settings-country" value={settings.country} onChange={(e) => changeCountry(e.target.value)}>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{countryName(c.code, settings.language)}</option>
        ))}
      </select>

      <label htmlFor="settings-currency">{t('settings.currency')}</label>
      <input id="settings-currency" type="text" value={settings.currency} onChange={(e) => changeCurrency(e.target.value)} />

      <label htmlFor="settings-theme">{t('settings.theme')}</label>
      <select id="settings-theme" value={settings.theme} onChange={(e) => changeTheme(e.target.value as 'dark' | 'light')}>
        <option value="dark">{t('settings.themeDark')}</option>
        <option value="light">{t('settings.themeLight')}</option>
      </select>

      <div className="sync-status">
        <p>{hasSupabaseConfig() ? t('settings.syncReady') : t('settings.syncLocalOnly')}</p>
        <button data-testid="sync-btn" disabled={!hasSupabaseConfig()}>{t('settings.syncNow')}</button>
      </div>
    </div>
  );
}
