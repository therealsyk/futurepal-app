import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { signIn, signUp, resetPassword, authErrorKey, hasSupabaseConfig } from '../auth/supabase';
import { signInWithProvider, type OAuthProvider } from '../auth/oauth';

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
  const [social, setSocial] = useState<OAuthProvider | null>(null);

  async function withProvider(p: OAuthProvider) {
    setError(''); setInfo(''); setSocial(p);
    try {
      await signInWithProvider(p);
      setInfo(t('auth.socialContinue')); // no Windows/telemóvel o login acaba no browser e a app atualiza sozinha
    } catch (err) {
      setError(t(authErrorKey(err)));
    } finally {
      setSocial(null);
    }
  }

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

      {mode !== 'reset' && (
        <div className="ob-social">
          <button type="button" className="ob-social-btn" onClick={() => withProvider('google')} disabled={!configured || social !== null} data-testid="login-google">
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            {t('auth.withGoogle')}
          </button>
          <button type="button" className="ob-social-btn" onClick={() => withProvider('facebook')} disabled={!configured || social !== null} data-testid="login-facebook">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1877F2"/><path fill="#fff" d="M13.4 19v-6h2l.3-2.4h-2.3V9.1c0-.7.2-1.2 1.2-1.2h1.2V5.8c-.2 0-1-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.8H9V13h2v6z"/></svg>
            {t('auth.withFacebook')}
          </button>
          <button type="button" className="ob-social-btn" onClick={() => withProvider('apple')} disabled={!configured || social !== null} data-testid="login-apple">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2.1-3.7 2.2-3.8-1.2-1.7-3-2-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4 1-1.4 1.3-2.7 1.4-2.8-.1 0-2.6-1-2.6-4.1zM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/></svg>
            {t('auth.withApple')}
          </button>
          <div className="ob-or"><span>{t('auth.or')}</span></div>
        </div>
      )}

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
