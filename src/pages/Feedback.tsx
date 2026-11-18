import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, Seg, Field } from '../ui/fx';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { loadSettings } from '../core/settings';
import { sendFeedback, type FeedbackKind } from '../core/feedback';

/** Janela "Enviar feedback": ideia, problema (bug) ou outro assunto. */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const close = () => { onClose(); setTimeout(() => { setSent(false); setError(''); }, 200); };

  async function send() {
    setBusy(true); setError('');
    const err = await sendFeedback(getSupabase(), { kind, message, email: auth.user?.email ?? email, language: loadSettings().language }).catch(() => 'feedback.errSend' as const);
    setBusy(false);
    if (err) { setError(t(err)); return; }
    setSent(true); setMessage(''); setKind('idea');
  }

  return (
    <Sheet open={open} onClose={close} title={t('feedback.title')}
      footer={sent
        ? <><span style={{ flex: 1 }} /><button type="button" className="fx-btn primary" onClick={close}>{t('common.close')}</button></>
        : <><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="fx-btn primary" disabled={busy} onClick={send} data-testid="feedback-send">{busy ? t('feedback.sending') : t('feedback.send')}</button></>}>
      {sent ? (
        <div className="fb-done" role="status">
          <b>{t('feedback.thanks')}</b>
          <p className="fx-muted">{t('feedback.thanksSub')}</p>
        </div>
      ) : (
        <>
          <p className="fx-muted" style={{ marginTop: 0 }}>{t('feedback.intro')}</p>
          <Seg<FeedbackKind> value={kind} onChange={setKind} label={t('feedback.kind')}
            options={[{ id: 'idea', label: t('feedback.idea') }, { id: 'bug', label: t('feedback.bug') }, { id: 'other', label: t('feedback.other') }]} />
          <Field label={kind === 'bug' ? t('feedback.bugLabel') : t('feedback.message')}>
            <textarea className="fx-input" rows={6} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder={kind === 'bug' ? t('feedback.bugPh') : t('feedback.messagePh')} data-testid="feedback-message" />
          </Field>
          {!auth.user && (
            <Field label={t('feedback.email')}>
              <input className="fx-input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('feedback.emailPh')} />
            </Field>
          )}
          <p className="fx-muted fx-small">{t('feedback.privacy')}</p>
          {error && <p className="fx-error" role="alert">{error}</p>}
        </>
      )}
    </Sheet>
  );
}
