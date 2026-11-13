import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COUNTRIES, countryName } from '../core/locale';
import { loadSettings, saveSettings, type AppSettings } from '../core/settings';

const LANGUAGES = [
  { code: 'pt-PT', label: 'Português (Portugal)' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

export default function SetupWizard({ onDone }: { onDone: (settings: AppSettings) => void }) {
  const { t, i18n } = useTranslation();
  const settings = loadSettings();
  const [language, setLanguage] = useState(settings.language);
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState(settings.currency);

  function pickCountry(code: string) {
    if (!code) return;
    setCountry(code);
    const info = COUNTRIES.find((c) => c.code === code);
    if (info) setCurrency(info.currency);
  }

  function finish() {
    // Compute the final country locally so we never depend on setState timing.
    const finalCountry = country || 'PT';
    const info = COUNTRIES.find((c) => c.code === finalCountry);
    const next: AppSettings = {
      language,
      country: finalCountry,
      currency: info ? info.currency : currency,
      theme: settings.theme,
    };
    saveSettings(next);
    onDone(next);
  }

  function skip() {
    // Persist a default country so the wizard does not reappear.
    const next: AppSettings = { ...settings, country: 'PT' };
    saveSettings(next);
    onDone(next);
  }

  return (
    <div className="wizard">
      <h1 className="page-title">{t('setup.welcome')}</h1>
      <p>{t('setup.intro')}</p>

      <label>{t('setup.language')}</label>
      <select
        value={language}
        onChange={(e) => {
          setLanguage(e.target.value);
          i18n.changeLanguage(e.target.value);
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>

      <label>{t('setup.country')}</label>
      <select value={country} onChange={(e) => pickCountry(e.target.value)}>
        <option value="">{t('setup.chooseCountry')}</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{countryName(c.code, language)}</option>
        ))}
      </select>

      <label>{t('setup.currency')}</label>
      <input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} />

      <div className="wizard-actions">
        <button className="btn primary" data-testid="finish-btn" onClick={finish}>{t('setup.finish')}</button>
        <button className="btn" data-testid="skip-btn" onClick={skip}>{t('setup.skip')}</button>
      </div>
    </div>
  );
}
