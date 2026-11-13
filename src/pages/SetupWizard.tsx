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

const DEFAULT_CATEGORY_KEYS = ['setup.catSalary', 'setup.catFood', 'setup.catTransport', 'setup.catHome', 'setup.catFun'];

export default function SetupWizard({ onDone }: { onDone: (settings: AppSettings) => void }) {
  const { t, i18n } = useTranslation();
  const settings = loadSettings();

  const [language, setLanguage] = useState(settings.language);
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState(settings.currency);
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(settings.firstDayOfWeek);
  const [dateFormat, setDateFormat] = useState(settings.dateFormat);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORY_KEYS.slice());
  const [account, setAccount] = useState<'none' | 'created' | 'signedin'>('none');

  function pickCountry(code: string) {
    if (!code) return;
    setCountry(code);
    const info = COUNTRIES.find((c) => c.code === code);
    if (info) {
      setCurrency(info.currency);
      setFirstDayOfWeek(info.firstDayOfWeek);
      setDateFormat(info.dateFormat);
    }
  }

  function toggleCategory(key: string) {
    setCategories((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function buildSettings(finalCountry: string): AppSettings {
    const info = COUNTRIES.find((c) => c.code === finalCountry);
    return {
      language,
      country: finalCountry,
      currency: info ? info.currency : currency,
      theme: settings.theme,
      firstDayOfWeek,
      dateFormat,
      account,
    };
  }

  function finish() {
    // Compute the final country locally so we never depend on setState timing.
    const finalCountry = country || 'PT';
    const next = buildSettings(finalCountry);
    saveSettings(next);
    onDone(next);
  }

  function skip() {
    // Persist a default country so the wizard does not reappear.
    const next = buildSettings('PT');
    saveSettings(next);
    onDone(next);
  }

  return (
    <div className="wizard">
      <h1 className="page-title">{t('setup.welcome')}</h1>
      <p>{t('setup.intro')}</p>

      <label htmlFor="setup-language">{t('setup.language')}</label>
      <select
        id="setup-language"
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

      <label htmlFor="setup-country">{t('setup.country')}</label>
      <select id="setup-country" value={country} onChange={(e) => pickCountry(e.target.value)}>
        <option value="">{t('setup.chooseCountry')}</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{countryName(c.code, language)}</option>
        ))}
      </select>

      <label htmlFor="setup-currency">{t('setup.currency')}</label>
      <input id="setup-currency" type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} />

      <label htmlFor="setup-firstday">{t('setup.firstDay')}</label>
      <select id="setup-firstday" value={firstDayOfWeek} onChange={(e) => setFirstDayOfWeek(Number(e.target.value))}>
        <option value="0">{t('setup.firstDaySunday')}</option>
        <option value="1">{t('setup.firstDayMonday')}</option>
      </select>

      <label htmlFor="setup-dateformat">{t('setup.dateFormat')}</label>
      <select id="setup-dateformat" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as 'DMY' | 'MDY' | 'YMD')}>
        <option value="DMY">DD/MM/YYYY</option>
        <option value="MDY">MM/DD/YYYY</option>
        <option value="YMD">YYYY-MM-DD</option>
      </select>

      <label>{t('setup.categories')}</label>
      <div className="wizard-categories">
        {DEFAULT_CATEGORY_KEYS.map((key) => (
          <label key={key} className="wizard-cat">
            <input type="checkbox" checked={categories.includes(key)} onChange={() => toggleCategory(key)} />
            <span>{t(key)}</span>
          </label>
        ))}
      </div>

      <label htmlFor="setup-account">{t('setup.account')}</label>
      <select id="setup-account" value={account} onChange={(e) => setAccount(e.target.value as 'none' | 'created' | 'signedin')}>
        <option value="none">{t('setup.accountNone')}</option>
        <option value="created">{t('setup.accountCreate')}</option>
        <option value="signedin">{t('setup.accountLogin')}</option>
      </select>

      <div className="wizard-actions">
        <button className="btn primary" data-testid="finish-btn" onClick={finish}>{t('setup.finish')}</button>
        <button className="btn" data-testid="skip-btn" onClick={skip}>{t('setup.skip')}</button>
      </div>
    </div>
  );
}
