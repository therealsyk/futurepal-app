import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { signIn, signUp, resetPassword, authErrorKey, hasSupabaseConfig } from '../auth/supabase';

type Mode = 'signin' | 'signup' | 'reset';

// Formulário de entrar / criar conta / recuperar palavra-passe (Supabase Auth).
// onDone corre quando há sessão; onSkip (opcional) mostra "Continuar sem conta".
export function LoginForm({ initialMode = 'signin', onDone, onSkip }: { initialMode?: Mode; onDone: () => void; onSkip?: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const configured = hasSupabaseConfig();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setInfo('');
    if (!email.includes('@')) { setError(t('auth.err_email')); return; }
    if (mode !== 'reset' && password.length < 6) { setError(t('auth.err_weak')); return; }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        onDone();
      } else if (mode === 'signup') {
        const r = await signUp(email.trim(), password, name.trim() || undefined);
        if (r.needsConfirmation) { setInfo(t('auth.checkEmail')); setMode('signin'); }
        else onDone();
      } else {
        await resetPassword(email.trim());
        setInfo(t('auth.resetSent'));
        setMode('signin');
      }
    } catch (err) {
      setError(t(authErrorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'signin' ? t('auth.signinTitle') : mode === 'signup' ? t('auth.signupTitle') : t('auth.resetTitle');
  const sub = mode === 'signin' ? t('auth.signinSub') : mode === 'signup' ? t('auth.signupSub') : t('auth.resetSub');

  return (
    <form className="ob-auth" onSubmit={submit} noValidate>
      <h1 className="ob-title">{title}</h1>
      <p className="ob-sub">{sub}</p>

      {!configured && <p className="ob-alert" role="status">{t('auth.err_notConfigured')}</p>}

      <div className="ob-card ob-form">
        {mode === 'signup' && (
          <label className="ob-input">
            <span>{t('auth.name')}</span>
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('auth.namePh')} />
          </label>
        )}
        <label className="ob-input">
          <span>{t('auth.email')}</span>
          <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@email.com" required />
        </label>
        {mode !== 'reset' && (
          <label className="ob-input">
            <span>{t('auth.password')}</span>
            <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
          </label>
        )}
        {mode === 'signin' && (
          <button type="button" className="ob-link small" onClick={() => { setMode('reset'); setError(''); setInfo(''); }}>{t('auth.forgot')}</button>
        )}
      </div>

      {error && <p className="ob-error" role="alert">{error}</p>}
      {info && <p className="ob-info" role="status">{info}</p>}

      <button type="submit" className="ob-cta" disabled={busy || !configured} data-testid="auth-submit">
        {busy ? t('auth.wait') : mode === 'signin' ? t('auth.signin') : mode === 'signup' ? t('auth.signup') : t('auth.sendReset')}
      </button>

      <div className="ob-switch">
        {mode === 'signin' ? (
          <>{t('auth.noAccount')} <button type="button" className="ob-link" onClick={() => { setMode('signup'); setError(''); }}>{t('auth.signup')}</button></>
        ) : (
          <>{t('auth.haveAccount')} <button type="button" className="ob-link" onClick={() => { setMode('signin'); setError(''); }}>{t('auth.signin')}</button></>
        )}
      </div>

      {onSkip && <button type="button" className="ob-ghost" onClick={onSkip} data-testid="auth-skip">{t('auth.skip')}</button>}
    </form>
  );
}
