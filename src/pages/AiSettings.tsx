import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PRESETS, getPreset, loadAiConfig, saveAiConfig, clearAiConfig, listModels, testConnection, maskKey, DEFAULT_AI, type AiConfig } from '../core/ai';
import { Ic, PickMenu } from '../ui/fx';
import { Row, SwitchRow } from '../ui/formFields';

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

  const field = (d: string, label: string, input: ReactNode) => <label className="lg-f"><span className="lg-ic"><Ic d={d} size={20} /></span><span className="lg-in"><small>{label}</small>{input}</span></label>;
  return (
    <div className="acc-form aix">
      <p>{t('ai.intro')}</p>
      <div className="tx-rows">
        <SwitchRow icon="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" label={t('ai.enable')} sub={t('ai.enableHint')} on={cfg.enabled} onChange={(v) => { const n = { ...cfg, enabled: v }; setCfg(n); if (cfg.model) { saveAiConfig({ ...n, apiKey: cfg.apiKey }); onSaved?.(n); } }} />
        <Row div icon="M6 6h12v12H6zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" label={t('ai.provider')}><PickMenu compact label={t('ai.provider')} testId="ai-provider" value={cfg.provider} options={AI_PRESETS.map((p) => ({ value: p.id, label: p.id === 'custom' ? t('ai.custom') : p.label }))} onChange={(v) => pickProvider(String(v))} /></Row>
      </div>
      <div className="mv-card lg-card">
        {(cfg.provider === 'custom' || cfg.provider === 'ollama' || cfg.provider === 'lmstudio') && field('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18', t('ai.baseUrl'), <input value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} placeholder="https://…/v1" />)}
        {field('M15 11a4 4 0 1 0-3.5-2L4 16.5V20h3.5v-2H10v-2.5l2.5-2.5A4 4 0 0 0 15 11z', t('ai.apiKey') + (preset && !preset.needsKey ? ` (${t('ai.optional')})` : ''), <input type="password" autoComplete="off" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={cfg.apiKey ? t('ai.keySaved', { key: maskKey(cfg.apiKey) }) : t('ai.keyPh')} data-testid="ai-key" />)}
        {field('M4 6h16M4 12h16M4 18h10', t('ai.model'), <><input list="ai-models" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder={t('ai.modelPh')} data-testid="ai-model" /><datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist></>)}
        <div className="aix-links">{preset?.keyUrl && <a href={preset.keyUrl} target="_blank" rel="noreferrer">{t('ai.getKey')}</a>}<button type="button" className="ob-link small" onClick={fetchModels} disabled={busy !== ''}>{busy === 'models' ? '…' : t('ai.fetchModels')}</button></div>
      </div>
      {status && <p className={(status.ok ? 'ob-info' : 'ob-error') + ' lg-msg'} role="status" data-testid="ai-status">{status.text}</p>}
      <button type="button" className="tx-addbtn" onClick={save} disabled={!cfg.model || !cfg.baseUrl} data-testid="ai-save">{t('common.save')}</button>
      <div className="aix-more"><button type="button" className="on-skip" onClick={test} disabled={busy !== '' || !cfg.model}>{busy === 'test' ? '…' : t('ai.test')}</button>{cfg.apiKey && <button type="button" className="ctf-del" onClick={remove}>{t('ai.remove')}</button>}</div>
      <div className="pv-note"><span className="pv-ic"><Ic d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" size={15} /></span><span>{t('ai.privacy')}</span></div>
    </div>
  );
}
