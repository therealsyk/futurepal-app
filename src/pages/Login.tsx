import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { setPendingAvatar } from '../core/avatar';
import { useTranslation } from 'react-i18next';
import { L } from '../i18n/phrases';
import logoUrl from '../assets/logo.svg';
import { Ic, Seg } from '../ui/fx';
import { signIn, signUp, resetPassword, authErrorKey, hasSupabaseConfig, enabledProviders, normalizePhone } from '../auth/supabase';
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
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const configured = hasSupabaseConfig();
  const [social, setSocial] = useState<OAuthProvider | null>(null);
  const [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<string | null>(null); // foto opcional do registo (enviada no 1.º login)
  const photoRef = useRef<HTMLInputElement>(null);
  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !f.type.startsWith('image/')) return;
    try { setPhoto(await setPendingAvatar(f)); } catch { setPhoto(null); }
  }
  const [providers, setProviders] = useState<Record<string, boolean> | null>(null);
  useEffect(() => { enabledProviders().then(setProviders).catch(() => setProviders({})); }, []);

  async function withProvider(p: OAuthProvider) {
    setError(''); setInfo('');
    if (providers && providers[p] === false) { setError(t('auth.err_providerOff')); return; }
    setSocial(p);
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
    const phoneNorm = phone.trim() ? normalizePhone(phone) : null;
    if (mode === 'signup' && phone.trim() && !phoneNorm) { setError(t('auth.err_phone')); return; }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        onDone();
      } else if (mode === 'signup') {
        const r = await signUp(email.trim(), password, name.trim() || undefined, phoneNorm ?? undefined);
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

  const go = (m: Mode) => { if (m === mode) return; setMode(m); setError(''); setInfo(''); };
  const field = (d: string, label: string, input: ReactNode) => <label className="lg-f"><span className="lg-ic"><Ic d={d} size={20} /></span><span className="lg-in"><small>{label}</small>{input}</span></label>;

  return (
    <form className="ob-auth lg" onSubmit={submit} noValidate>
      <div className="lg-top">
        <img className="lg-logo" src={logoUrl} alt="" />
        <div key={mode} className="lg-head"><h1 className="ob-title">{title}</h1><p className="ob-sub">{sub}</p></div>
      </div>

      {!configured && <p className="ob-alert" role="status">{t('auth.err_notConfigured')}</p>}

      {mode !== 'reset' && <div className="tx-seg lg-seg"><Seg value={mode} onChange={(m) => go(m as Mode)} label={L('Entrar')} options={[{ id: 'signin', label: t('auth.signin') }, { id: 'signup', label: t('auth.signup') }]} /></div>}

      <div className="mv-card lg-card">
        <div className={'acc-exp' + (mode === 'signup' ? ' open' : '')} aria-hidden={mode !== 'signup'}><div>{mode === 'signup' && <>
          <div className="lg-photo">
            <button type="button" className="lg-photobtn" onClick={() => photoRef.current?.click()} aria-label={t('profile.addOptional')} data-testid="signup-photo">{photo ? <img src={photo} alt="" /> : <Ic d="M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" size={24} />}</button>
            <span><b>{photo ? t('profile.change') : t('profile.addOptional')}</b>{photo && <button type="button" className="ob-link small" onClick={() => { setPendingAvatar(null); setPhoto(null); }}>{t('profile.remove')}</button>}</span>
            <input ref={photoRef} hidden type="file" accept="image/*" onChange={pickPhoto} />
          </div>
          {field('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20.5a8 8 0 0 1 16 0', t('auth.name'), <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('auth.namePh')} />)}
          {field('M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A15 15 0 0 1 4 5a1 1 0 0 1 1-1z', t('auth.phone'), <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="912 345 678" />)}
        </>}</div></div>
        {field('M3 6h18v12H3zM3 7l9 7 9-7', t('auth.email'), <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={L('nome@email.com')} required />)}
        {mode !== 'reset' && <div className="lg-pass">
          {field('M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 15v2', t('auth.password'), <input type={show ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />)}
          <button type="button" className="lg-eye" aria-pressed={show} aria-label={show ? L('Esconder palavra-passe') : L('Mostrar palavra-passe')} onClick={() => setShow(!show)}><Ic d={show ? 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 20L20 4' : 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'} size={20} /></button>
        </div>}
        {mode === 'signin' && <button type="button" className="ob-link small lg-forgot" onClick={() => go('reset')}>{t('auth.forgot')}</button>}
      </div>

      {error && <p className="ob-error lg-msg" role="alert" key={error}>{error}</p>}
      {info && <p className="ob-info lg-msg" role="status">{info}</p>}

      <button type="submit" className={'ob-cta lg-go' + (busy ? ' busy' : '')} disabled={busy || !configured} data-testid="auth-submit">
        {busy ? t('auth.wait') : mode === 'signin' ? t('auth.signin') : mode === 'signup' ? t('auth.signup') : t('auth.sendReset')}
        {busy ? <i className="lg-spin" aria-hidden="true" /> : <Ic d="M5 12h14M13 6l6 6-6 6" size={18} />}
      </button>
      {mode === 'reset' && <button type="button" className="on-skip" onClick={() => go('signin')}>{L('Voltar')}</button>}

      {mode !== 'reset' && <>
        <div className="ob-or lg-or"><span>{L('ou entra com')}</span></div>
        <div className="lg-social">
          <button type="button" onClick={() => withProvider('google')} disabled={!configured || social !== null} aria-label={t('auth.withGoogle')} data-testid="login-google">
            <svg width="24" height="24" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg><b>Google</b></button>
          <button type="button" onClick={() => withProvider('facebook')} disabled={!configured || social !== null} aria-label={t('auth.withFacebook')} data-testid="login-facebook">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1877F2"/><path fill="#fff" d="M13.4 19v-6h2l.3-2.4h-2.3V9.1c0-.7.2-1.2 1.2-1.2h1.2V5.8c-.2 0-1-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.8H9V13h2v6z"/></svg><b>Facebook</b></button>
          <button type="button" onClick={() => withProvider('apple')} disabled={!configured || social !== null} aria-label={t('auth.withApple')} data-testid="login-apple">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2.1-3.7 2.2-3.8-1.2-1.7-3-2-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4 1-1.4 1.3-2.7 1.4-2.8-.1 0-2.6-1-2.6-4.1zM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/></svg><b>Apple</b></button>
        </div>
      </>}

      {onSkip && <button type="button" className="on-skip lg-skip" onClick={onSkip} data-testid="auth-skip">{t('auth.skip')}</button>}
    </form>
  );
}
