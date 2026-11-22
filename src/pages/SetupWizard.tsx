// Primeira utilização: uma pergunta, uma ação útil e só depois (se a pessoa quiser) criar conta.
// Abertura -> o que queres fazer primeiro? -> primeira ação -> guardar o progresso (opcional) -> Início.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { getSupabase, hasSupabaseConfig } from '../auth/supabase';
import { ensureDefaultAccount } from '../core/accounts';
import { todayISO } from '../core/dates';
import { addGoal, addGroup, ensureDefaultCategories, setSalary } from '../core/finance';
import { COUNTRIES } from '../core/locale';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { chooseGoal, finishOnboarding, milestone, screen, startOnboarding, type Goal1 } from '../core/onboarding';
import { syncSalaryTransactions } from '../core/salaryTx';
import { loadSettings, saveSettings, type AppSettings } from '../core/settings';
import { mirrorSettings } from '../core/settingsSync';
import { activateDatabaseFor, db } from '../db/app-db';
import { L } from '../i18n/phrases';
import { runSync } from '../sync/runSync';
import { CountMoney } from '../ui/CountMoney';
import { DatePicker } from '../ui/DatePicker';
import { AmountField, FI, SwitchRow, TextRow } from '../ui/formFields';
import { appConfirm } from '../ui/confirm';
import { Ic, ICON } from '../ui/fx';
import { fill } from '../ui/AccountPlan';
import { GoalRing } from '../ui/GoalRing';
import { useMissing } from '../ui/missing';
import { openTxForm, TxFormHost, useTxSaved } from '../ui/TxForm';
import logoUrl from '../assets/logo.svg';
import { LoginForm } from './Login';
import { BottomSheet } from './SimplePages';
import { currencySymbol, groupCurrencies } from '../core/currencies';
import { currencyFlagUrl } from '../ui/currencyFlag';

type Step = 'splash' | 'ask' | 'act' | 'done' | 'keep' | 'auth' | 'signup';
const LANGUAGES = ['pt-PT', 'pt-BR', 'en', 'es', 'fr'] as const;
// o fuso horário diz melhor onde a pessoa está do que a língua (ex.: aparelho em inglês em Portugal)
const ZONES: Array<[RegExp, string]> = [[/Lisbon|Madeira|Azores/, 'PT'], [/Sao_Paulo|Bahia|Fortaleza|Manaus|Recife|Belem|Cuiaba/, 'BR'], [/Madrid|Canary|Ceuta/, 'ES'], [/Europe\/Paris/, 'FR'], [/Europe\/London/, 'GB'], [/Dublin/, 'IE'], [/Berlin/, 'DE'], [/Zurich/, 'CH'], [/Mexico/, 'MX'], [/Argentina|Buenos_Aires/, 'AR'], [/Tokyo/, 'JP'], [/^Australia/, 'AU'], [/Toronto|Vancouver|Montreal|Halifax|Edmonton|Winnipeg/, 'CA']];
const IC = {
  expenses: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', goal: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  split: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8', save: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01',
};
// o que há na app, num relance
const FEATS: Array<[string, string]> = [[IC.expenses, 'Despesas'], [ICON.wallet, 'Contas'], [IC.goal, 'Metas'], ['M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z', 'Limites'], [IC.split, 'Grupos'], ['M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', 'Recorrentes'], ['M3 7h18v12H3zM3 11h18M7 15h3', 'Salários'], ['M5 5h14v15H5zM5 10h14M8 3v4M16 3v4', 'Calendário'], ['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 'Assistente IA']];
const GROUP_COLOR = '#17c3c9';

export const ONBOARDED_FLAG = 'wallet.justOnboarded';

/** Língua do aparelho; país (e moeda) pelo fuso horário ou pela região. Muda-se depois em Definições. */
function guess(): { language: AppSettings['language']; country: string } {
  const nav = navigator.language || 'pt-PT', [l, c] = nav.split('-');
  const language = LANGUAGES.find((x) => x === nav) ?? LANGUAGES.find((x) => x.startsWith(l)) ?? 'en';
  let zone = ''; try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* sem fuso */ }
  const by = ZONES.find(([re]) => re.test(zone))?.[1] ?? c?.toUpperCase();
  return { language, country: COUNTRIES.some((x) => x.code === by) ? by! : language === 'pt-BR' ? 'BR' : language === 'es' ? 'ES' : language === 'fr' ? 'FR' : 'PT' };
}

export default function SetupWizard({ onDone }: { onDone: (settings: AppSettings) => void }) {
  const { t, i18n } = useTranslation();
  const initial = loadSettings(), auth = useAuth();
  const [g0] = useState(guess);
  const [step, setStep] = useState<Step>('splash');
  const [goal, setGoal] = useState<Goal1>('expenses');
  const [language] = useState(initial.country ? initial.language : g0.language);
  const [country] = useState(initial.country || g0.country);
  const [signedIn, setSignedIn] = useState(false), [syncNote, setSyncNote] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const info = COUNTRIES.find((c) => c.code === country), regional = info?.currency ?? initial.currency ?? 'EUR';
  const [cur, setCur] = useState(''), [choosing, setChoosing] = useState(false), currency = cur || regional; // a moeda pergunta-se antes do primeiro valor
  const loginHandled = useRef(false); // o login (formulário ou social) só é tratado uma vez
  useEffect(() => { ensureDefaultCategories(db).catch(() => {}); startOnboarding(); if (i18n.language !== language) i18n.changeLanguage(language); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { screen(step === 'act' ? 'act_' + goal : step); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  // Login social: acaba fora da app; quando a sessão chega, o setup continua sozinho.
  useEffect(() => {
    if (step === 'auth' && auth.user && !signedIn && !syncNote) afterLogin().catch(() => setStep('ask'));
    if (step === 'signup' && auth.user && !signedIn) { setSignedIn(true); finish({ ...build(), account: 'signedin' }).catch(() => {}); }
  }, [auth.user?.id, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const build = (): AppSettings => ({ ...initial, language, country, currency, firstDayOfWeek: info ? info.firstDayOfWeek : initial.firstDayOfWeek, dateFormat: info ? info.dateFormat : initial.dateFormat, account: signedIn ? 'signedin' : 'none' }) as AppSettings;
  async function finish(from?: AppSettings) {
    const s = from ?? build();
    await ensureDefaultAccount(db, s.currency, t('accounts.mainName'));
    const saved = saveSettings(s);
    await mirrorSettings(db, saved);
    finishOnboarding(s.account === 'signedin');
    try { sessionStorage.setItem(ONBOARDED_FLAG, '1'); } catch { /* sem storage */ }
    onDone(s);
  }
  // "Já tenho conta": traz os dados da nuvem. Se a conta já foi configurada noutro aparelho, entra logo na app.
  async function afterLogin() {
    if (loginHandled.current) return;
    loginHandled.current = true;
    setSignedIn(true);
    const sb = getSupabase();
    if (sb) {
      setSyncNote(t('onboard.syncing'));
      const { data } = await sb.auth.getUser();
      if (data.user) {
        await activateDatabaseFor(data.user.id);
        await ensureDefaultCategories(db);
        const res = await runSync(sb, db, data.user.id);
        if (!res.error && res.settings) { await finish({ ...res.settings, account: 'signedin' }); return; }
      }
      setSyncNote('');
    }
    setStep('ask');
  }
  const after = () => (signedIn || !hasSupabaseConfig() ? finish().catch(() => {}) : setStep('keep'));
  const back = () => setStep(step === 'ask' || step === 'auth' ? 'splash' : step === 'act' ? 'ask' : step === 'signup' ? 'keep' : 'act');
  const money = (c: number) => formatMoney(c, currency, language);
  const pick = (g: Goal1) => { setGoal(g); chooseGoal(g); if (cur) setStep('act'); else setChoosing(true); };
  const choices: Array<[Goal1, string]> = [['expenses', L('Controlar as minhas despesas')], ['goal', L('Poupar para uma meta')], ['split', L('Dividir despesas com outras pessoas')], ['save', L('Ver quanto posso poupar')]];

  return (
    <div className="ob-screen on-screen">
      {step !== 'splash' && step !== 'done' && step !== 'keep' && <div className="ob-top"><button type="button" className="ob-round" onClick={back} aria-label={t('onboard.back')}><Ic d={ICON.left} size={20} /></button>{step !== 'auth' && step !== 'signup' && <button type="button" className="on-skip" onClick={() => finish().catch(() => {})}>{L('Agora não')}</button>}</div>}
      {step === 'splash' && <div className="on-feats" aria-hidden="true"><div>{[0, 1].map((k) => <span key={k}>{FEATS.map(([d, label]) => <b key={label}><Ic d={d} size={18} />{L(label)}</b>)}</span>)}</div></div>}
      <div className="ob-body on-body" key={step}>
        {step === 'splash' && <div className="on-center">
          <img className="on-brand" src={logoUrl} alt="FuturePal" />
          <h1>FuturePal</h1>
          <p>{L('Controla as tuas despesas e descobre para onde vai cada cêntimo, no poupar é que está o ganho.')}</p>
          <button type="button" className="ob-cta" onClick={() => setStep('ask')} data-testid="ob-start">{L('Começar')}</button>
          {hasSupabaseConfig() && <button type="button" className="on-skip" onClick={() => { setAuthMode('signin'); setStep('auth'); }} data-testid="ob-login">{L('Já tenho conta')}</button>}
        </div>}
        {step === 'ask' && <div className="on-col">
          <h1>{L('O que queres fazer primeiro?')}</h1>
          <div className="on-choices">{choices.map(([id, label], i) => <button key={id} type="button" style={{ '--i': i } as CSSProperties} onClick={() => pick(id)} data-testid={'ob-goal-' + id}><span><Ic d={IC[id]} size={26} /></span><b>{label}</b><Ic d={ICON.right} size={18} /></button>)}</div>
        </div>}
        {step === 'act' && goal === 'expenses' && <ExpenseAct currency={currency} language={language} onDone={() => setStep('done')} />}
        {step === 'act' && goal === 'goal' && <GoalAct currency={currency} onCurrency={() => setChoosing(true)} onDone={() => setStep('done')} />}
        {step === 'act' && goal === 'split' && <GroupAct currency={currency} language={language} onDone={() => setStep('done')} />}
        {step === 'act' && goal === 'save' && <SaveAct currency={currency} onCurrency={() => setChoosing(true)} money={money} onDone={after} />}
        {step === 'done' && <div className="on-center">
          <span className="on-ok"><Ic d="M20 6 9 17l-5-5" size={46} /></span>
          <h1>{goal === 'expenses' ? L('Despesa guardada') : goal === 'goal' ? L('Meta criada') : L('Grupo criado')}</h1>
          <p>{goal === 'expenses' ? L('Já a vês no resumo deste mês.') : goal === 'goal' ? L('A app mostra quanto falta e quando lá chegas.') : L('Junta pessoas em Grupos quando quiseres.')}</p>
          <button type="button" className="ob-cta" onClick={after}>{t('onboard.continue')}</button>
        </div>}
        {step === 'keep' && <div className="on-center">
          <span className="on-logo"><Ic d="M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.6 1.5A3.5 3.5 0 0 1 17.5 18M12 12v8M9 15l3-3 3 3" size={44} /></span>
          <h1>{L('Queres guardar o teu progresso?')}</h1>
          <p>{L('A tua conta guarda despesas, grupos, metas e limites em todos os dispositivos.')}</p>
          <button type="button" className="ob-cta" onClick={() => { setAuthMode('signup'); setStep('signup'); }}>{L('Criar conta')}</button>
          <button type="button" className="ob-outline" onClick={() => { setAuthMode('signin'); setStep('signup'); }}>{L('Entrar')}</button>
          <button type="button" className="on-skip" onClick={async () => { if (await appConfirm(L('Tens a certeza? Sem conta, os teus dados ficam só neste aparelho e podem perder-se.'), { ok: L('Continuar sem conta') })) finish().catch(() => {}); }} data-testid="ob-continue">{L('Continuar sem conta')}</button>
        </div>}
        {step === 'auth' && (syncNote ? <p className="ob-sub" role="status">{syncNote}</p> : <LoginForm key={authMode} initialMode={authMode} onDone={() => { afterLogin().catch(() => setStep('ask')); }} onSkip={() => setStep('ask')} />)}
        {/* Os dados ficam neste aparelho; ao entrar na conta, a app pergunta se os quer levar para lá. */}
        {step === 'signup' && <div className="ob-last"><LoginForm key={authMode} initialMode={authMode} onDone={() => { setSignedIn(true); finish({ ...build(), account: 'signedin' }).catch(() => {}); }} onSkip={() => { finish().catch(() => {}); }} /></div>}
      </div>
      <TxFormHost />
      {choosing && <CurrencySheet language={language} value={currency} suggested={regional} onClose={() => setChoosing(false)} onPick={(c) => { setCur(c); setChoosing(false); if (step === 'ask') setStep('act'); }} />}
    </div>
  );
}

const Head = ({ d, title, text }: { d: string; title: string; text?: string }) => <div className="on-head"><span className="on-logo sm"><Ic d={d} size={34} /></span><h1>{title}</h1>{text && <p>{text}</p>}</div>;
const Form = ({ children }: { children: ReactNode }) => <div className="mv-card on-form"><div className="acc-form">{children}</div></div>;

function ExpenseAct({ currency, language, onDone }: { currency: string; language: string; onDone: () => void }) {
  useTxSaved(onDone);
  return <div className="on-center"><Head d={IC.expenses} title={L('Vamos adicionar a tua primeira despesa')} text={L('Escreve o valor, escolhe uma categoria e, se quiseres, indica a data e a conta onde pagaste.')} /><button type="button" className="ob-cta" onClick={() => openTxForm({ type: 'expense', currency, language, first: true })} data-testid="ob-add-tx"><Ic d={ICON.plus} size={18} />{L('Adicionar despesa')}</button></div>;
}
function GoalAct({ currency, onCurrency, onDone }: { currency: string; onCurrency: () => void; onDone: () => void }) {
  const [name, setName] = useState(''), [v, setV] = useState(''), [has, setHas] = useState(false), [end, setEnd] = useState('');
  const c = parseMoneyToCents(v) ?? 0, missing = useMissing(), miss = missing([['v', L('o valor'), c > 0], ['name', L('o nome'), !!name.trim()], ['end', L('a data limite'), !has || !!end]]);
  return <div className="on-col"><Head d={IC.goal} title={L('Qual é a tua primeira meta?')} /><Form>{miss.note}
    <AmountField value={v} onChange={setV} currency={currency} onCurrency={onCurrency} cls={miss.cls('v')} />
    <div className="tx-rows"><TextRow icon={FI.target} label={L('Meta')} value={name} onChange={setName} placeholder={L('Ex.: Férias, carro')} cls={miss.cls('name')} />
      <SwitchRow icon={FI.date} cls={miss.cls('end')} label={has ? L('Data limite') : L('Tem data limite?')} on={has} onChange={setHas}><DatePicker value={end} onChange={setEnd} className="fx-input tx-val" /></SwitchRow></div>
    <button type="button" className="tx-addbtn" onClick={async () => { if (!miss.check()) return; await addGoal(db, name.trim(), c, todayISO(), has ? end : null); milestone('goal'); onDone(); }}>{L('Criar meta')}</button></Form></div>;
}
function GroupAct({ currency, language, onDone }: { currency: string; language: string; onDone: () => void }) {
  const [name, setName] = useState(''), [id, setId] = useState('');
  useTxSaved(() => { if (id) onDone(); });
  const missing = useMissing(), miss = missing([['name', L('o nome'), !!name.trim()]]);
  if (id) return <div className="on-center"><Head d={IC.expenses} title={L('Adiciona a primeira despesa do grupo')} text={name} /><button type="button" className="ob-cta" onClick={() => openTxForm({ type: 'expense', groupId: id, currency, language, first: true })}><Ic d={ICON.plus} size={18} />{L('Adicionar despesa')}</button><button type="button" className="on-skip" onClick={onDone}>{L('Agora não')}</button></div>;
  return <div className="on-col"><Head d={IC.split} title={L('Cria o teu primeiro grupo')} text={L('Cria um grupo, adiciona pessoas e divide despesas automaticamente.')} /><Form>{miss.note}
    <div className="tx-rows"><TextRow icon={FI.name} label={L('Nome do grupo')} value={name} onChange={setName} placeholder={L('Ex.: Férias de verão')} cls={miss.cls('name')} /></div>
    <button type="button" className="tx-addbtn" onClick={async () => { if (!miss.check()) return; const g = await addGroup(db, name.trim(), GROUP_COLOR); milestone('group'); setId(g.id); }}>{L('Criar grupo')}</button></Form></div>;
}
function SaveAct({ currency, onCurrency, money, onDone }: { currency: string; onCurrency: () => void; money: (c: number) => string; onDone: () => void }) {
  const [v, setV] = useState(''), [inc, setInc] = useState(0);
  const c = parseMoneyToCents(v) ?? 0, missing = useMissing(), miss = missing([['v', L('o valor'), c > 0]]);
  const keep = async () => { const n = new Date(); await setSalary(db, n.getFullYear(), n.getMonth() + 1, inc); await syncSalaryTransactions(db, currency).catch(() => {}); milestone('income'); onDone(); };
  if (inc > 0) return <div className="on-center"><GoalRing r={0.2} size={168}><b>20%</b></GoalRing><h1>{L('Podes poupar cerca de')}</h1><b className="on-big fx-pos"><CountMoney cents={Math.round(inc * 0.2)} money={money} /></b><p>{fill(L('por mês, ou {m} num ano. É uma estimativa: guardar 20% do que recebes. Com as tuas despesas fica mais certa.'), { m: money(Math.round(inc * 2.4)) })}</p><button type="button" className="ob-cta" onClick={() => { keep().catch(onDone); }}>{L('Guardar como salário deste mês')}</button><button type="button" className="on-skip" onClick={onDone}>{L('Continuar sem guardar')}</button></div>;
  return <div className="on-col"><Head d={IC.save} title={L('Quanto recebes por mês?')} /><Form>{miss.note}<AmountField value={v} onChange={setV} currency={currency} onCurrency={onCurrency} kind="income" cls={miss.cls('v')} /><button type="button" className="tx-addbtn" onClick={() => { if (miss.check()) setInc(c); }}>{L('Calcular')}</button></Form></div>;
}

/** Escolher a moeda: a da região em cima, e as outras com pesquisa. */
function CurrencySheet({ language, value, suggested, onPick, onClose }: { language: string; value: string; suggested: string; onPick: (c: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const all = groupCurrencies(language, q).flatMap((g) => g.items), first = groupCurrencies(language, '').flatMap((g) => g.items).filter((c) => c.code === suggested);
  const list = q ? all : [...first, ...all.filter((c) => c.code !== suggested)];
  return (
    <BottomSheet title={t('onboard.currencyTitle')} onClose={onClose}>
      <label className="ob-search"><Ic d={ICON.search} size={18} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('onboard.search')} aria-label={t('onboard.search')} /></label>
      <div className="on-curs" role="radiogroup" aria-label={t('onboard.currencyTitle')}>{list.map((c, i) => (
        <button key={c.code} type="button" role="radio" aria-checked={value === c.code} className={value === c.code ? 'on' : ''} onClick={() => onPick(c.code)}>
          {currencyFlagUrl(c.code) ? <img className="ob-coin ob-flag" src={currencyFlagUrl(c.code)!} alt="" /> : <span className="ob-coin">{currencySymbol(c.code, language)}</span>}
          <span><b>{c.name}</b><small>{c.code}{!q && i === 0 && first.length > 0 ? ` · ${L('Sugerida para a tua região')}` : ''}</small></span>{value === c.code && <Ic d="M20 6 9 17l-5-5" size={18} />}
        </button>))}
        {list.length === 0 && <p className="fx-muted">{t('onboard.noResults')}</p>}
      </div>
    </BottomSheet>
  );
}
