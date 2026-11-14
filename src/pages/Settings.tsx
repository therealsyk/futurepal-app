import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PageTitle } from './index';
import { COUNTRIES, countryName } from '../core/locale';
import { loadSettings, saveSettings, setTheme, type AppSettings } from '../core/settings';
import { hasSupabaseConfig, getSupabase, canSync } from '../auth/supabase';
import { syncNow } from '../sync/supabase-sync';
import { db } from '../db/app-db';
import { exportBackup, importBackup, parseExcelBuffer, commitExcelRows, type BackupData } from '../core/backup';

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
  const [syncMsg, setSyncMsg] = useState('');
  const [backupMsg, setBackupMsg] = useState('');
  const [excelPreview, setExcelPreview] = useState<{ rows: ReturnType<typeof parseExcelBuffer>; total: number } | null>(null);

  async function onExportBackup() {
    try {
      const data = await exportBackup(db);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallet-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg(t('settings.backupExported'));
    } catch (err) {
      setBackupMsg(t('settings.backupError', { error: String(err) }));
    }
  }

  async function onImportBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as BackupData;
      const count = await importBackup(db, data);
      setBackupMsg(t('settings.backupImported', { count }));
    } catch (err) {
      setBackupMsg(t('settings.backupError', { error: String(err) }));
    } finally {
      e.target.value = '';
    }
  }

  async function onExcelFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const rows = parseExcelBuffer(buf);
      setExcelPreview({ rows, total: rows.length });
    } catch (err) {
      setBackupMsg(t('settings.excelError', { error: String(err) }));
      e.target.value = '';
    }
  }

  async function onCommitExcel() {
    if (!excelPreview) return;
    try {
      const count = await commitExcelRows(db, excelPreview.rows);
      setBackupMsg(t('settings.excelImported', { count }));
      setExcelPreview(null);
    } catch (err) {
      setBackupMsg(t('settings.excelError', { error: String(err) }));
    }
  }

  async function onSync() {
    setSyncMsg('');
    const client = getSupabase();
    if (!client) {
      setSyncMsg(t('settings.syncNoUser'));
      return;
    }
    const { data } = await client.auth.getUser();
    const user = data.user ?? null;
    if (!canSync(user)) {
      setSyncMsg(t('settings.syncNoUser'));
      return;
    }
    // Settings row is created by the Setup Wizard (seedSettings); if it does not
    // exist yet (user skipped/never finished wizard), there is nothing to sync.
    const existing = await db.settings.toArray();
    if (existing.length === 0) {
      setSyncMsg(t('settings.syncNoUser'));
      return;
    }
    const result = await syncNow(client, db, user!.id, existing[0].lastSync);
    if (result.error) {
      setSyncMsg(t('settings.syncError', { error: result.error }));
    } else {
      setSyncMsg(t('settings.syncSuccess', { pushed: result.pushed, pulled: result.pulled }));
    }
  }

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

  function changeTheme(theme: 'dark' | 'light' | 'gray') {
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
      <select id="settings-theme" value={settings.theme} onChange={(e) => changeTheme(e.target.value as 'dark' | 'light' | 'gray')}>
        <option value="dark">{t('settings.themeDark')}</option>
        <option value="light">{t('settings.themeLight')}</option>
        <option value="gray">{t('settings.themeGray')}</option>
      </select>

      <div className="sync-status">
        <p>{hasSupabaseConfig() ? t('settings.syncReady') : t('settings.syncLocalOnly')}</p>
        <button data-testid="sync-btn" disabled={!hasSupabaseConfig()} onClick={onSync}>{t('settings.syncNow')}</button>
        {syncMsg && <p data-testid="sync-result">{syncMsg}</p>}
      </div>

      <div className="backup-section">
        <h2>{t('settings.backupTitle')}</h2>
        <button data-testid="backup-export-btn" onClick={onExportBackup}>{t('settings.backupExport')}</button>
        <label htmlFor="backup-import-file">{t('settings.backupImport')}</label>
        <input id="backup-import-file" type="file" accept="application/json" data-testid="backup-import-input" onChange={onImportBackup} />
        {backupMsg && <p data-testid="backup-result">{backupMsg}</p>}
      </div>

      <div className="excel-section">
        <h2>{t('settings.excelTitle')}</h2>
        <label htmlFor="excel-import-file">{t('settings.excelImport')}</label>
        <input id="excel-import-file" type="file" accept=".xlsx,.xls" data-testid="excel-import-input" onChange={onExcelFile} />
        {excelPreview && (
          <div data-testid="excel-preview">
            <p>{t('settings.excelPreview', { count: excelPreview.total })}</p>
            <button data-testid="excel-commit-btn" disabled={excelPreview.total === 0} onClick={onCommitExcel}>
              {t('settings.excelConfirm')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
