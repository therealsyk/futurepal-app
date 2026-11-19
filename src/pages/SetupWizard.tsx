import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COUNTRIES, countryName } from '../core/locale';
import { formatMoney } from '../core/money';
import { loadSettings, saveSettings, type AppSettings } from '../core/settings';
import { groupCurrencies, currencySymbol } from '../core/currencies';
import { addAccount, ensureDefaultAccount, listAccounts, updateAccount } from '../core/accounts';
import { addTransaction, addGoal, activeCategories, ensureDefaultCategories } from '../core/finance';
import { parseMoneyToCents } from '../core/money';
import { db, activateDatabaseFor } from '../db/app-db';
import type { Account, Category, Transaction, Goal } from '../db/database';
import { mirrorSettings } from '../core/settingsSync';
import { getSupabase, hasSupabaseConfig } from '../auth/supabase';
import { runSync } from '../sync/runSync';
import { LoginForm } from './Login';
import { useAuth } from '../auth/AuthContext';
import { Ic, ICON, Sheet, Seg, catLabel, CategorySelect } from '../ui/fx';
import { todayISO } from '../core/dates';
import { currencyFlagUrl } from '../ui/currencyFlag';

// Primeira utilização, um passo por ecrã (como numa app de telemóvel):
// boas-vindas -> (entrar) -> moeda -> primeira conta -> transações -> meta -> criar conta (opcional).
type Step = 'welcome' | 'auth' | 'currency' | 'account' | 'transactions' | 'goal' | 'signup';
const ORDER: Step[] = ['welcome', 'currency', 'account', 'transactions', 'goal'];

const LANGUAGES = [
  { code: 'pt-PT', label: 'Português (Portugal)' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

const today = todayISO;

export const ONBOARDED_FLAG = 'wallet.justOnboarded';

export default function SetupWizard({ onDone }: { onDone: (settings: AppSettings) => void }) {
  const { t, i18n } = useTranslation();
  const initial = loadSettings();
  const [step, setStep] = useState<Step>('welcome');
  const [language, setLanguage] = useState(initial.language);
  const [country, setCountry] = useState(initial.country || 'PT');
  const [currency, setCurrency] = useState(initial.currency || 'EUR');
  const [signedIn, setSignedIn] = useState(false);
  // Conta de gastos criada neste setup: ao voltar atrás e avançar de novo é editada, não duplicada.
  const [setupAccount, setSetupAccount] = useState<Account | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [syncNote, setSyncNote] = useState('');
  const auth = useAuth();
  const loginHandled = useRef(false); // o login (formulário ou social) só é tratado uma vez
  // Login social (Google/Facebook/Apple): acaba fora da app; quando a sessão chega, o setup continua sozinho.
  useEffect(() => {
    if (step === 'auth' && auth.user && !signedIn && !syncNote) afterLogin().catch(() => setStep('currency'));
    // último passo (criar conta) com Google/Facebook/Apple: quando a sessão chega, termina o setup
    if (step === 'signup' && auth.user && !signedIn) { setSignedIn(true); finish({ ...buildSettings(), account: 'signedin' }).catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id, step]);

  useEffect(() => { ensureDefaultCategories(db).catch(() => {}); }, []);

  function pickLanguage(code: string) {
    setLanguage(code);
    i18n.changeLanguage(code);
  }

  function pickCountry(code: string) {
    setCountry(code);
    const info = COUNTRIES.find((c) => c.code === code);
    if (info) setCurrency(info.currency);
  }

  function back() {
    if (step === 'auth') { setStep('welcome'); return; }
    if (step === 'signup') { setStep('goal'); return; }
    const i = ORDER.indexOf(step);
    if (i > 0) setStep(ORDER[i - 1]);
  }

  function next() {
    const i = ORDER.indexOf(step);
    if (i < ORDER.length - 1) setStep(ORDER[i + 1]);
    else if (step === 'goal' && hasSupabaseConfig()) { setAuthMode('signup'); setStep('signup'); } // último passo: criar conta ou entrar
    else finish();
  }

  function buildSettings(): AppSettings {
    const info = COUNTRIES.find((c) => c.code === country);
    return {
      ...initial,
      language,
      country,
      currency,
      firstDayOfWeek: info ? info.firstDayOfWeek : initial.firstDayOfWeek,
      dateFormat: info ? info.dateFormat : initial.dateFormat,
      account: signedIn ? 'signedin' : 'none',
    };
  }

  async function finish(fromSync?: AppSettings) {
    const s = fromSync ?? buildSettings();
    await ensureDefaultAccount(db, s.currency, t('accounts.mainName'));
    const saved = saveSettings(s);
    await mirrorSettings(db, saved);
    try { sessionStorage.setItem(ONBOARDED_FLAG, '1'); } catch { /* sem storage */ }
    onDone(s);
  }

  // Depois de entrar: traz os dados da nuvem. Se a conta já foi configurada noutro aparelho, salta o resto.
  async function afterLogin() {
    if (loginHandled.current) return;
    loginHandled.current = true;
    setSignedIn(true);
    const sb = getSupabase();
    if (sb) {
      setSyncNote(t('onboard.syncing'));
      const { data } = await sb.auth.getUser();
      if (data.user) {
        await activateDatabaseFor(data.user.id); // a partir daqui, os dados são os desta conta
        await ensureDefaultCategories(db);
        const res = await runSync(sb, db, data.user.id);
        if (!res.error && res.settings) {
          await finish({ ...res.settings, account: 'signedin' });
          return;
        }
      }
      setSyncNote('');
    }
    setStep('currency');
  }

  const showBack = step !== 'welcome';
  const dots = ORDER.indexOf(step);

  return (
    <div className="ob-screen">
      <div className="ob-top">
        {showBack ? (
          <button type="button" className="ob-round" onClick={back} aria-label={t('onboard.back')}><Ic d={ICON.left} size={20} /></button>
        ) : <span className="ob-round-spacer" />}
        {dots > 0 && (
          <div className="ob-dots" aria-hidden="true">
            {ORDER.slice(1).map((s, i) => <i key={s} className={i < dots ? 'on' : ''} />)}
          </div>
        )}
        <span className="ob-round-spacer" />
      </div>

      <div className="ob-body">
        {step === 'welcome' && (
          <Welcome
            language={language} country={country} onLanguage={pickLanguage} onCountry={pickCountry}
            onStart={() => setStep('currency')}
          />
        )}
        {step === 'signup' && (
          // Os dados do setup ficam neste aparelho; ao entrar na conta, a app pergunta se os quer levar para lá.
          <div className="ob-last">
            <LoginForm key={authMode} initialMode={authMode} onDone={() => { setSignedIn(true); finish({ ...buildSettings(), account: 'signedin' }).catch(() => {}); }} onSkip={() => { finish().catch(() => {}); }} />
          </div>
        )}
        {step === 'auth' && (
          syncNote ? <p className="ob-sub" role="status">{syncNote}</p>
            : <LoginForm key={authMode} initialMode={authMode} onDone={() => { afterLogin().catch(() => setStep('currency')); }} onSkip={() => setStep('currency')} />
        )}
        {step === 'currency' && <CurrencyStep language={language} value={currency} onChange={setCurrency} />}
        {step === 'account' && <AccountStep currency={currency} language={language} existing={setupAccount} onCreated={(a) => { setSetupAccount(a); next(); }} />}
        {step === 'transactions' && <TransactionsStep currency={currency} language={language} />}
        {step === 'goal' && <GoalStep currency={currency} language={language} />}
      </div>

      {step !== 'welcome' && step !== 'auth' && step !== 'account' && step !== 'signup' && (
        <div className="ob-foot">
          <button type="button" className="ob-cta" onClick={next} data-testid="ob-continue">{t('onboard.continue')}</button>
        </div>
      )}
    </div>
  );
}

function Welcome({ language, country, onLanguage, onCountry, onStart, onLogin }: {
  language: string; country: string; onLanguage: (c: string) => void; onCountry: (c: string) => void; onStart: () => void; onLogin?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ob-welcome">
      <div className="ob-logo" aria-hidden="true"><Ic d={ICON.wallet} size={34} /></div>
      <h1 className="ob-title">{t('onboard.welcomeTitle')}</h1>
      <p className="ob-sub">{t('onboard.welcomeSub')}</p>

      <div className="ob-card ob-rows">
        <label className="ob-row">
          <span className="ob-row-text"><b>{t('settings.language')}</b><small>{t('onboard.languageHint')}</small></span>
          <select className="ob-pill" value={language} onChange={(e) => onLanguage(e.target.value)} data-testid="ob-language">
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label className="ob-row">
          <span className="ob-row-text"><b>{t('settings.country')}</b><small>{t('onboard.countryHint')}</small></span>
          <select className="ob-pill" value={country} onChange={(e) => onCountry(e.target.value)} data-testid="ob-country">
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{countryName(c.code, language)}</option>)}
          </select>
        </label>
      </div>

      <div className="ob-actions">
        <button type="button" className="ob-cta" onClick={onStart} data-testid="ob-start">{t('onboard.start')}</button>
        {onLogin && <button type="button" className="ob-outline" onClick={onLogin} data-testid="ob-login">{t('onboard.haveAccount')}</button>}
      </div>
    </div>
  );
}

function CurrencyStep({ language, value, onChange }: { language: string; value: string; onChange: (c: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupCurrencies(language, query), [language, query]);
  return (
    <div>
      <h1 className="ob-title small">{t('onboard.currencyTitle')}</h1>
      <label className="ob-search">
        <Ic d={ICON.search} size={18} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('onboard.search')} aria-label={t('onboard.search')} />
      </label>
      <div role="radiogroup" aria-label={t('onboard.currencyTitle')}>
        {groups.map((g) => (
          <section key={g.letter} className="ob-group">
            <h2>{g.letter}</h2>
            <div className="ob-card ob-list">
              {g.items.map((c) => (
                <button key={c.code} type="button" role="radio" aria-checked={value === c.code} className={'ob-option' + (value === c.code ? ' on' : '')} onClick={() => onChange(c.code)}>
                  <span className="ob-radio" aria-hidden="true" />
                  {currencyFlagUrl(c.code)
                    ? <img className="ob-coin ob-flag" src={currencyFlagUrl(c.code)!} alt="" aria-hidden="true" />
                    : <span className="ob-coin" aria-hidden="true">{currencySymbol(c.code, language)}</span>}
                  <span>{c.name} ({c.code})</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="ob-sub">{t('onboard.noResults')}</p>}
      </div>
    </div>
  );
}

function AccountStep({ currency, language, existing, onCreated }: {
  currency: string; language: string; existing: Account | null; onCreated: (acc: Account | null) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [balance, setBalance] = useState(existing && existing.initialBalanceCents !== 0 ? (Math.abs(existing.initialBalanceCents) / 100).toFixed(2).replace('.', ',') : '');
  const [positive, setPositive] = useState(existing ? existing.initialBalanceCents >= 0 : true);
  const [netWorth, setNetWorth] = useState(existing?.includeInNetWorth ?? true);
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? true);
  const [showHome, setShowHome] = useState(existing?.showOnHome ?? true);
  const [error, setError] = useState('');

  async function create(useDefaultName = false) {
    const finalName = useDefaultName ? t('accounts.mainName') : name.trim();
    const cents = balance.trim() ? parseMoneyToCents(balance) : 0;
    if (cents === null) { setError(t('onboard.badAmount')); return; }
    if (useDefaultName && existing) { onCreated(existing); return; } // já criada neste setup: não cria outra
    if (useDefaultName && (await listAccounts(db)).length > 0) { onCreated(null); return; }
    const input = {
      name: finalName, description: description.trim(), type: 'spending' as const, currency,
      initialBalanceCents: positive ? Math.abs(cents) : -Math.abs(cents), includeInNetWorth: netWorth, isDefault, showOnHome: showHome,
    };
    if (existing) {
      await updateAccount(db, existing.id, input);
      onCreated({ ...existing, ...input });
    } else {
      onCreated(await addAccount(db, input));
    }
  }

  return (
    <div className="ob-account">
      <h1 className="ob-title small left">{t('onboard.accountTitle')}</h1>
      <input className="ob-huge" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('onboard.accountNamePh')} aria-label={t('onboard.accountName')} data-testid="ob-account-name" />
      <label className="ob-label">{t('onboard.descriptionOpt')}</label>
      <input className="ob-big" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('onboard.descriptionPh')} />
      <hr className="ob-hr" />
      <div className="ob-balance">
        <div>
          <label className="ob-label muted" htmlFor="ob-balance">{t('onboard.initialBalance')}</label>
          <input id="ob-balance" className="ob-amount" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" />
        </div>
        <span className="ob-pill static">{currencyFlagUrl(currency) ? <img className="ob-coin sm ob-flag" src={currencyFlagUrl(currency)!} alt="" /> : <span className="ob-coin sm">{currencySymbol(currency, language)}</span>}{currency}</span>
      </div>
      <hr className="ob-hr" />
      <SwitchRow on={positive} onChange={setPositive} title={t('onboard.positive')} hint={t('onboard.positiveHint')} />
      <SwitchRow on={netWorth} onChange={setNetWorth} title={t('onboard.netWorth')} hint={t('onboard.netWorthHint')} />
      <SwitchRow on={isDefault} onChange={setIsDefault} title={t('onboard.default')} hint={t('onboard.defaultHint')} />
      <SwitchRow on={showHome} onChange={setShowHome} title={t('onboard.showHome')} hint={t('onboard.showHomeHint')} />
      {error && <p className="ob-error" role="alert">{error}</p>}
      <div className="ob-foot inline">
        <button type="button" className="ob-cta" disabled={!name.trim()} onClick={() => create()} data-testid="ob-account-create">{t('onboard.createAccount')}</button>
        <button type="button" className="ob-ghost" onClick={() => create(true)}>{t('onboard.skipStep')}</button>
      </div>
    </div>
  );
}

function SwitchRow({ on, onChange, title, hint }: { on: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <div className="ob-switchrow">
      <div><b>{title}</b><span>{hint}</span></div>
      <button type="button" role="switch" aria-checked={on} aria-label={title} className={'ob-toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}><i /></button>
    </div>
  );
}

function TransactionsStep({ currency, language }: { currency: string; language: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [catId, setCatId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    activeCategories(db).then((c) => { setCats(c); if (c[0]) setCatId(c[0].id); }).catch(() => {});
  }, []);

  async function save() {
    const cents = parseMoneyToCents(amount);
    if (!cents || cents <= 0) { setError(t('onboard.badAmount')); return; }
    const accounts = await listAccounts(db);
    const acc = accounts.find((a) => a.isDefault) ?? accounts[0];
    const tx = await addTransaction(db, {
      date: today(), type, categoryId: catId, description: desc.trim(), amountCents: cents, currency, accountId: acc?.id,
    });
    setList((l) => [tx, ...l]);
    setAmount(''); setDesc(''); setError(''); setOpen(false);
  }

  return (
    <div className="ob-center">
      <h1 className="ob-title">{t('onboard.txTitle')}</h1>
      <p className="ob-sub">{t('onboard.txSub')}</p>
      <div className="ob-card ob-empty">
        {list.length === 0 ? (
          <>
            <span className="ob-empty-ic"><Ic d={ICON.wallet} size={34} /></span>
            <p>{t('onboard.noTx')}</p>
          </>
        ) : (
          <ul className="ob-txlist">
            {list.map((tx) => {
              const c = cats.find((x) => x.id === tx.categoryId);
              return (
                <li key={tx.id}>
                  <span>{tx.description || (c ? catLabel(t, c) : '')}</span>
                  <b className={tx.type === 'income' ? 'pos' : ''}>{(tx.type === 'expense' ? '-' : '+') + formatMoney(tx.amountCents, currency, language)}</b>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="ob-outline" onClick={() => setOpen(true)} data-testid="ob-add-tx">{t('onboard.addTx')}</button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('onboard.addTx')}
        footer={<button type="button" className="ob-cta" onClick={save}>{t('common.add')}</button>}>
        <Seg<'expense' | 'income'> value={type} onChange={setType} label={t('onboard.addTx')}
          options={[{ id: 'expense', label: t('onboard.expense') }, { id: 'income', label: t('onboard.income') }]} />
        <input className="ob-amount center" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" aria-label={t('onboard.amount')} autoFocus />
        <input className="fx-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('onboard.txDescPh')} aria-label={t('onboard.txDescPh')} />
        <CategorySelect cats={cats} kind={type} value={catId} onChange={setCatId} ariaLabel={t('onboard.category')} />
        {error && <p className="ob-error" role="alert">{error}</p>}
      </Sheet>
    </div>
  );
}

function GoalStep({ currency, language }: { currency: string; language: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState('');

  async function save() {
    const cents = parseMoneyToCents(target);
    if (!name.trim()) { setError(t('onboard.goalNameReq')); return; }
    if (!cents || cents <= 0) { setError(t('onboard.badAmount')); return; }
    const g = await addGoal(db, name.trim(), cents, today());
    setGoals((l) => [...l, g]);
    setName(''); setTarget(''); setError(''); setOpen(false);
  }

  const features = [
    { cls: 'green', d: ICON.target, title: t('onboard.goalF1'), sub: t('onboard.goalF1Sub') },
    { cls: 'blue', d: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z', title: t('onboard.goalF2'), sub: t('onboard.goalF2Sub') },
    { cls: 'red', d: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4', title: t('onboard.goalF3'), sub: t('onboard.goalF3Sub') },
  ];

  return (
    <div className="ob-center">
      <h1 className="ob-title">{t('onboard.goalTitle')}</h1>
      <p className="ob-sub">{t('onboard.goalSub')}</p>
      <div className="ob-card ob-features">
        {goals.length === 0 ? features.map((f) => (
          <div key={f.title} className="ob-feature">
            <span className={'ob-feat-ic ' + f.cls}><Ic d={f.d} size={24} /></span>
            <div><b>{f.title}</b><span>{f.sub}</span></div>
          </div>
        )) : (
          <ul className="ob-txlist">
            {goals.map((g) => <li key={g.id}><span>{g.name}</span><b>{formatMoney(g.targetCents, currency, language)}</b></li>)}
          </ul>
        )}
        <button type="button" className="ob-outline" onClick={() => setOpen(true)} data-testid="ob-add-goal">{t('onboard.createGoal')}</button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('onboard.createGoal')}
        footer={<button type="button" className="ob-cta" onClick={save}>{t('common.save')}</button>}>
        <input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('onboard.goalNamePh')} aria-label={t('onboard.goalNamePh')} autoFocus />
        <input className="ob-amount center" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0,00" aria-label={t('onboard.goalTarget')} />
        {error && <p className="ob-error" role="alert">{error}</p>}
      </Sheet>
    </div>
  );
}
