import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PRESETS, getPreset, loadAiConfig, saveAiConfig, clearAiConfig, listModels, testConnection, maskKey, DEFAULT_AI, type AiConfig } from '../core/ai';
import { Toggle, PickMenu } from '../ui/fx';

// Painel "Modelos de IA": a pessoa escolhe o fornecedor, cola a SUA chave e escolhe o modelo.
export function AiSettings({ onSaved }: { onSaved?: (cfg: AiConfig) => void }) {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<AiConfig>(loadAiConfig());
  const [keyDraft, setKeyDraft] = useState('');
  const [models, setModels] = useState<string[]>(getPreset(cfg.provider)?.models ?? []);
  const [busy, setBusy] = useState<'' | 'models' | 'test'>('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const preset = getPreset(cfg.provider);

  // Usa a chave nova se foi escrita; senão mantém a guardada.
  const effective = (): AiConfig => ({ ...cfg, apiKey: keyDraft.trim() || cfg.apiKey });

  function pickProvider(id: string) {
    const p = getPreset(id);
    setCfg({ ...cfg, provider: id, baseUrl: p?.baseUrl ?? '', model: p?.models?.[0] ?? '', apiKey: '' });
    setKeyDraft('');
    setModels(p?.models ?? []);
    setStatus(null);
  }

  async function fetchModels() {
    setBusy('models'); setStatus(null);
    try {
      const list = await listModels(effective());
      setModels(list);
      if (!cfg.model && list[0]) setCfg((c) => ({ ...c, model: list[0] }));
      setStatus({ ok: true, text: t('ai.modelsFound', { count: list.length }) });
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      setStatus({ ok: false, text: msg.includes('Failed to fetch') ? t('ai.cors') : t('ai.error', { error: msg }) });
    } finally {
      setBusy('');
    }
  }

  async function test() {
    setBusy('test'); setStatus(null);
    const r = await testConnection({ ...effective(), enabled: true });
    setStatus({ ok: r.ok, text: r.ok ? t('ai.testOk', { reply: r.message }) : r.message === 'network/CORS' ? t('ai.cors') : t('ai.error', { error: r.message }) });
    setBusy('');
  }

  function save() {
    const next = { ...effective(), enabled: true };
    saveAiConfig(next);
    setCfg(next);
    setKeyDraft('');
    setStatus({ ok: true, text: t('ai.saved') });
    onSaved?.(next);
  }

  function remove() {
    clearAiConfig();
    setCfg({ ...DEFAULT_AI });
    setKeyDraft('');
    setModels([]);
    setStatus({ ok: true, text: t('ai.removed') });
    onSaved?.({ ...DEFAULT_AI });
  }

  return (
    <div className="ai-panel">
      <p className="fx-muted fx-small">{t('ai.intro')}</p>

      <Toggle on={cfg.enabled} onChange={(v) => { const n = { ...cfg, enabled: v }; setCfg(n); if (cfg.model) { saveAiConfig({ ...n, apiKey: cfg.apiKey }); onSaved?.(n); } }}
        label={t('ai.enable')} hint={t('ai.enableHint')} />

      <label className="fx-field"><span>{t('ai.provider')}</span>
        <PickMenu label={t('ai.provider')} testId="ai-provider" value={cfg.provider} options={AI_PRESETS.map((p) => ({ value: p.id, label: p.id === 'custom' ? t('ai.custom') : p.label }))} onChange={(v) => pickProvider(String(v))} />
      </label>

      {(cfg.provider === 'custom' || cfg.provider === 'ollama' || cfg.provider === 'lmstudio') && (
        <label className="fx-field"><span>{t('ai.baseUrl')}</span>
          <input className="fx-input" value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} placeholder="https://…/v1" />
        </label>
      )}

      <label className="fx-field"><span>{t('ai.apiKey')}{preset && !preset.needsKey ? ` (${t('ai.optional')})` : ''}</span>
        <input className="fx-input" type="password" autoComplete="off" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
          placeholder={cfg.apiKey ? t('ai.keySaved', { key: maskKey(cfg.apiKey) }) : t('ai.keyPh')} data-testid="ai-key" />
      </label>
      {preset?.keyUrl && <a className="ai-keylink" href={preset.keyUrl} target="_blank" rel="noreferrer">{t('ai.getKey')}</a>}

      <label className="fx-field"><span>{t('ai.model')}</span>
        <div className="fx-inline">
          <input className="fx-input" list="ai-models" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder={t('ai.modelPh')} data-testid="ai-model" />
          <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          <button type="button" className="fx-btn" onClick={fetchModels} disabled={busy !== ''}>{busy === 'models' ? '…' : t('ai.fetchModels')}</button>
        </div>
      </label>

      {status && <p className={'fx-small ' + (status.ok ? 'fx-pos' : 'fx-neg')} role="status" data-testid="ai-status">{status.text}</p>}

      <div className="ai-actions">
        <button type="button" className="fx-btn" onClick={test} disabled={busy !== '' || !cfg.model}>{busy === 'test' ? '…' : t('ai.test')}</button>
        <span style={{ flex: 1 }} />
        {cfg.apiKey && <button type="button" className="fx-btn danger" onClick={remove}>{t('ai.remove')}</button>}
        <button type="button" className="fx-btn primary" onClick={save} disabled={!cfg.model || !cfg.baseUrl} data-testid="ai-save">{t('common.save')}</button>
      </div>
      <p className="fx-muted fx-small">{t('ai.privacy')}</p>
    </div>
  );
}
