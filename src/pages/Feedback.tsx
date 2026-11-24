import { L } from '../i18n/phrases';
import { FormError, useMissing } from '../ui/missing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ic, Sheet } from '../ui/fx';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { loadSettings } from '../core/settings';
import { sendFeedback, type FeedbackKind } from '../core/feedback';

const KINDS: Array<[FeedbackKind, string]> = [['idea', 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'], ['bug', 'M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0zM4 8l4 2M20 8l-4 2M4 18l4-2M20 18l-4-2M3 13h5M16 13h5M9 5 7 3M15 5l2-2'], ['other', 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5']];

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

  const missing = useMissing();
  const close = () => { onClose(); missing([]).reset(); setTimeout(() => { setSent(false); setError(''); }, 200); };

  const miss = missing([['msg', L('a mensagem'), !!message.trim()]]);
  async function send() {
    if (!miss.check()) return;
    setBusy(true); setError('');
    const err = await sendFeedback(getSupabase(), { kind, message, email: auth.user?.email ?? email, language: loadSettings().language }).catch(() => 'feedback.errSend' as const);
    setBusy(false);
    if (err) { setError(t(err)); return; }
    setSent(true); setMessage(''); setKind('idea');
  }

  return (
    <Sheet open={open} onClose={close} title={t('feedback.title')}>
      {sent ? (
        <div className="acc-form fbx done" role="status">
          <span className="on-ok"><Ic d="M20 6 9 17l-5-5" size={46} /></span>
          <h2>{t('feedback.thanks')}</h2><p>{t('feedback.thanksSub')}</p>
          <button type="button" className="tx-addbtn" onClick={close}>{t('common.close')}</button>
        </div>
      ) : (
        <div className="acc-form fbx">
          <p className="fbx-intro">{t('feedback.intro')}</p>
          <div className="st2-acts" role="radiogroup" aria-label={t('feedback.kind')}>
            {KINDS.map(([id, d]) => <button key={id} type="button" role="radio" aria-checked={kind === id} className={kind === id ? 'on' : ''} onClick={() => setKind(id)}><span className="lg-ic"><Ic d={d} size={20} /></span><b>{t('feedback.' + id)}</b></button>)}
          </div>
          {miss.note}
          <div className="mv-card lg-card">
            <label className={'lg-f top' + miss.cls('msg')}><span className="lg-ic"><Ic d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5" size={20} /></span><span className="lg-in"><small>{kind === 'bug' ? t('feedback.bugLabel') : t('feedback.message')}</small>
              <textarea className="fbx-msg" rows={2} maxLength={4000} value={message} onChange={(e) => { setMessage(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 260)}px`; }} placeholder={kind === 'bug' ? t('feedback.bugPh') : t('feedback.messagePh')} data-testid="feedback-message" /></span></label>
            {!auth.user && <label className="lg-f"><span className="lg-ic"><Ic d="M3 6h18v12H3zM3 7l9 7 9-7" size={20} /></span><span className="lg-in"><small>{t('feedback.email')}</small><input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('feedback.emailPh')} /></span></label>}
          </div>
          {error && <FormError text={error} />}
          <button type="button" className="tx-addbtn" disabled={busy} onClick={send} data-testid="feedback-send">{busy ? t('feedback.sending') : t('feedback.send')}</button>
          <div className="pv-note"><span className="pv-ic"><Ic d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4" size={15} /></span><span>{t('feedback.privacy')}</span></div>
        </div>
      )}
    </Sheet>
  );
}
