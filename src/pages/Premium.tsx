import type { CSSProperties } from 'react';
import { fill } from '../ui/AccountPlan';
import { L } from '../i18n/phrases';
import { useMissing } from '../ui/missing';
import { LockedPreview } from '../ui/LockedPreview';
import { trackEvent } from '../core/presence';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { newId, stampNew, type Category, type Transaction, type Warranty } from '../db/database';
import { activeCategories } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { activePlan, hasFeature, loadPlan, PLAN_EVENT, PRICES, savePlan, type Feature, type PlanId } from '../core/plan';
import {
  businessCsv, businessQuarters, CHALLENGE_DEFS, efaturaDeadline, evaluateChallenge, irsSummary,
  warrantyDaysLeft, warrantyEnd, yearReview, type Challenge, type ChallengeType,
} from '../core/premium';
import { catLabel, EmptyState, Field, Ic, ICON, PageHead, Sheet } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';

// ---------------------------------------------------------------- comum
const LOCK = 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3';

export function usePlan() {
  const [s, setS] = useState(loadPlan());
  useEffect(() => {
    const on = () => setS(loadPlan());
    window.addEventListener(PLAN_EVENT, on);
    return () => window.removeEventListener(PLAN_EVENT, on);
  }, []);
  return { state: s, plan: activePlan(s), has: (f: Feature) => hasFeature(f, s) };
}

function useData() {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [salaries, setSalaries] = useState<Array<{ year: number; amountCents: number; deletedAt: string | null }>>([]);
  useEffect(() => {
    (async () => {
      setTxs((await db.transactions.toArray()).filter((t) => t.deletedAt === null));
      setCats(await activeCategories(db));
      setSalaries(await db.salaries.toArray());
    })().catch(() => {});
  }, []);
  return { txs, cats, salaries };
}

function useMoney() {
  const s = loadSettings();
  return { money: (c: number) => formatMoney(c, s.currency, s.language), lang: s.language };
}

/** Mostra a página se o plano a inclui; senão, um convite discreto para o Plus (nunca um pop-up). */
export function Locked({ feature, children }: { feature: Feature; children: ReactNode }) {
  const { t } = useTranslation();
  const { has } = usePlan();
  if (has(feature)) return <>{children}</>;
  const pro = feature === 'freelance';
  // Assistente: prévia desfocada da conversa por trás do cadeado
  if (feature === 'assistant') return <LockedPreview kind="chat" title={t('plus.lockedTitle')} text={t('plus.feat_' + feature)} action={<Link to="/plus" className="fx-btn primary">{t('plus.seePlans')}</Link>} />;
  return (
    <div className="pm-locked">
      <span className="pm-lock-ic"><Ic d={LOCK} size={26} /></span>
      <h3>{t(pro ? 'plus.lockedPro' : 'plus.lockedTitle')}</h3>
      <p>{t('plus.feat_' + feature)}</p>
      <Link to="/plus" className="fx-btn primary">{t('plus.seePlans')}</Link>
    </div>
  );
}

// ---------------------------------------------------------------- planos + atalhos
const FEATURE_PAGES: Array<{ f: Feature; path: string; d: string }> = [
  { f: 'assistant', path: '/assistente', d: 'M4 5h16v11H9l-5 4zM9 10h.01M12 10h.01M15 10h.01' },
  { f: 'irs', path: '/irs', d: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7' },
  { f: 'subscriptions', path: '/subscricoes', d: 'M4 9h13l-3-3M20 15H7l3 3' },
  { f: 'yearReview', path: '/ano', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { f: 'challenges', path: '/desafios', d: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3' },
  { f: 'warranties', path: '/garantias', d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4' },
  { f: 'shared', path: '/casa', d: 'M3 11l9-7 9 7M5 10v10h14V10M9 20v-6h6v6' },
  { f: 'split', path: '/grupos', d: 'M12 3v18M5 8h7M12 16h7M4 21h16' },
  { f: 'freelance', path: '/independentes', d: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16' },
];
const PLAN_ICON: Record<PlanId, string> = { free: 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2', plus: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z', pro: 'M3 18h18M4 15l-1-9 5 4 4-6 4 6 5-4-1 9z' };
// Os 3 planos: cada um tem tudo o do anterior. Preço sempre por mês; no anual, o equivalente mensal.
const PLANS: Array<{ id: PlanId; features: string[] }> = [
  { id: 'free', features: ['freeBasics', 'freeSync', 'split', 'freeLimits'] },
  { id: 'plus', features: ['unlimited', 'forecast', 'subscriptions', 'yearReview', 'challenges', 'warranties', 'irs', 'assistantPlan'] },
  { id: 'pro', features: ['shared', 'freelance', 'aiMore', 'early'] },
];
export function PlusPage() {
  const auth = useAuth();
  const { t } = useTranslation();
  const { state, plan } = usePlan();
  const { money } = useMoney();
  const [yearly, setYearly] = useState(false);
  const priceOf = (id: PlanId) => {
    if (id === 'free') return { main: money(0), note: t('plus.forever') };
    const p = PRICES[id];
    return yearly
      ? { main: money(Math.round(p.year / 12)), note: t('plus.billedYearly', { price: money(p.year) }) }
      : { main: money(p.month), note: t('plus.billedMonthly') };
  };
  // "Quero subscrever": regista o interesse da conta (ainda não há pagamentos)
  const [wanted, setWanted] = useState<string | null>(null);
  const [wantMsg, setWantMsg] = useState('');
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !auth.user) return;
    sb.from('plan_interest').select('plan').eq('user_id', auth.user.id).maybeSingle().then(({ data }) => setWanted(data?.plan ?? null), () => {});
  }, [auth.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const want = async (id: 'plus' | 'pro') => {
    const sb = getSupabase();
    if (!sb || !auth.user) { setWantMsg(t('plus.wantLogin')); return; }
    const { error } = await sb.from('plan_interest').upsert({ user_id: auth.user.id, plan: id, period: yearly ? 'year' : 'month', updated_at: new Date().toISOString() });
    if (error) { setWantMsg(t('plus.wantError')); return; }
    setWanted(id); setWantMsg(t('plus.wantThanks', { plan: t('plus.plan_' + id) }));
  };
  return (
    <div className="fx-page mv sh pl-page">
      <header className="mv-head"><h1 className="sh-title">{L('Planos')}</h1></header>
      <section className="pl-intro">
        <span className="pl-spark"><Ic d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" size={30} /></span>
        <div><b>{L('Os planos estão quase a chegar')}</b><p>{L('Diz-nos qual queres e avisamos-te quando estiver disponível.')}</p></div>
        <div className="pm-billing" role="group" aria-label={t('plus.billing')}>
          <button type="button" className={!yearly ? 'on' : ''} aria-pressed={!yearly} onClick={() => setYearly(false)}>{t('plus.monthly')}</button>
          <button type="button" className={yearly ? 'on' : ''} aria-pressed={yearly} onClick={() => setYearly(true)}>{t('plus.yearly')} <em>{t('plus.twoFree')}</em></button>
        </div>
      </section>
      {wantMsg && <p className="pm-banner" role="status">{wantMsg}</p>}
      <div className="pl-cards">
        {PLANS.map((p, i) => {
          const pr = priceOf(p.id), mine = plan === p.id, asked = wanted === p.id;
          return (
            <section key={p.id} className={'mv-card pl-card k-' + p.id + (mine ? ' mine' : '')} style={{ '--i': i } as CSSProperties}>
              {p.id === 'plus' && <span className="pl-flag">{L('Recomendado')}</span>}
              <span className="pl-ic"><Ic d={PLAN_ICON[p.id]} size={34} /></span>
              <h2>{t('plus.plan_' + p.id)}</h2>
              <p className="pl-price"><b key={String(yearly)}>{pr.main}</b>{p.id !== 'free' && <small>/{t('plus.month')}</small>}</p>
              <p className="pl-note">{pr.note}</p>
              {i > 0 && <p className="pl-inherit">{t('plus.everythingIn', { plan: t('plus.plan_' + PLANS[i - 1].id) })}</p>}
              <ul>{p.features.map((f, k) => <li key={f} style={{ '--k': k } as CSSProperties}><i><Ic d="M20 6 9 17l-5-5" size={13} /></i>{t('plus.short_' + f)}</li>)}</ul>
              {mine ? <span className="pl-mine"><Ic d="M20 6 9 17l-5-5" size={16} />{t('plus.current')}</span> : p.id !== 'free' && (
                <button type="button" className={'pl-want' + (asked ? ' done' : '')} disabled={asked} onClick={() => want(p.id as 'plus' | 'pro')}>
                  {asked ? <><Ic d="M20 6 9 17l-5-5" size={17} />{L('Pedido registado')}</> : fill(L('Quero o {d}'), { d: t('plus.plan_' + p.id) })}
                </button>
              )}
            </section>
          );
        })}
      </div>
      {import.meta.env.DEV && (
        <div className="pm-dev">
          <b>DEV</b>
          {(['free', 'plus', 'pro'] as PlanId[]).map((id) => (
            <button key={id} type="button" className={'fx-btn' + (state.plan === id ? ' primary' : '')} onClick={() => savePlan({ ...state, plan: id })}>{id}</button>
          ))}
          <button type="button" className="fx-btn" onClick={() => savePlan({ plan: 'free', trialEndsAt: null, trialUsed: false })}>reset</button>
        </div>
      )}
      <h2 className="pm-h2 pl-h2">{t('plus.toolsTitle')}</h2>
      <div className="pm-tools">
        {FEATURE_PAGES.map((x) => (
          <Link key={x.path} to={x.path} className="pm-tool">
            <span><Ic d={x.d} size={22} /></span>
            <b>{t('plus.short_' + x.f)}</b>
            <small>{t('plus.feat_' + x.f)}</small>
            {!hasFeature(x.f, state) && <i className="pm-mini-lock"><Ic d={LOCK} size={14} /></i>}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Modo IRS
export function IrsPage() {
  const { t } = useTranslation();
  const { txs, cats } = useData();
  const { money } = useMoney();
  const [year, setYear] = useState(new Date().getFullYear());
  const lines = useMemo(() => irsSummary(txs, cats, year), [txs, cats, year]);
  const est = lines.reduce((s, l) => s + (l.estimateCents ?? 0), 0);
  const deadline = efaturaDeadline(year).split('-').reverse().join('/');
  return (
    <div className="fx-page">
      <PageHead title={t('plus.irsTitle')} />
      <Locked feature="irs">
        <div className="pm-row">
          <button type="button" className="fx-btn" onClick={() => setYear(year - 1)}><Ic d={ICON.left} /></button>
          <b className="pm-year">{year}</b>
          <button type="button" className="fx-btn" onClick={() => setYear(year + 1)}><Ic d={ICON.right} /></button>
        </div>
        <div className="pm-hero">
          <small>{t('plus.irsEstimate')}</small>
          <strong>{money(est)}</strong>
          <span>{t('plus.irsDeadline', { date: deadline })}</span>
        </div>
        <div className="pm-list">
          {lines.map((l) => (
            <div key={l.group} className="fx-card pm-irs">
              <div className="pm-irs-top"><b>{t('plus.irs_' + l.group)}</b><b>{money(l.totalCents)}</b></div>
              <small className="fx-muted">{t('plus.irsHint_' + l.group)}</small>
              {l.capCents !== null && <div className="pm-bar"><i style={{ width: `${Math.min(100, ((l.estimateCents ?? 0) / l.capCents) * 100)}%` }} /></div>}
              <small>{l.estimateCents !== null
                ? t('plus.irsLine', { est: money(l.estimateCents), cap: l.capCents !== null ? money(l.capCents) : '—', n: l.count })
                : t('plus.irsVat', { n: l.count })}</small>
            </div>
          ))}
        </div>
        <p className="fx-muted fx-small">{t('plus.irsDisclaimer')}</p>
      </Locked>
    </div>
  );
}

// ---------------------------------------------------------------- subscrições
// ---------------------------------------------------------------- o teu ano em números
export function YearPage() {
  const { t } = useTranslation();
  const { txs, cats, salaries } = useData();
  const { money, lang } = useMoney();
  const [year, setYear] = useState(new Date().getFullYear());
  const sal = salaries.filter((s) => s.deletedAt === null && s.year === year).reduce((a, s) => a + s.amountCents, 0);
  const r = useMemo(() => yearReview(txs, cats, year, sal), [txs, cats, year, sal]);
  const monthName = (m: number) => new Intl.DateTimeFormat(lang, { month: 'long' }).format(new Date(year, m - 1, 1));
  const topCat = r.topCategory ? cats.find((c) => c.id === r.topCategory!.categoryId) : undefined;
  const cards: Array<[string, string, string?]> = [
    [t('plus.yrSpent'), money(r.spentCents), t('plus.yrPerDay', { v: money(r.avgPerDayCents) })],
    [t('plus.yrSaved'), money(r.savedCents), t('plus.yrIncome', { v: money(r.incomeCents) })],
    [t('plus.yrTop'), topCat ? catLabel(t, topCat) : '—', r.topCategory ? money(r.topCategory.cents) : undefined],
    [t('plus.yrDay'), r.priciestDay ? r.priciestDay.date.split('-').reverse().join('/') : '—', r.priciestDay ? money(r.priciestDay.cents) : undefined],
    [t('plus.yrBest'), r.cheapestMonth ? monthName(r.cheapestMonth.month) : '—', r.cheapestMonth ? money(r.cheapestMonth.cents) : undefined],
    [t('plus.yrCoffee'), String(r.coffeeCount), money(r.coffeeCents)],
  ];
  const share = async () => {
    const text = t('plus.yrShare', { year, spent: money(r.spentCents), saved: money(r.savedCents), n: r.count });
    try { if (navigator.share) await navigator.share({ text }); else await navigator.clipboard.writeText(text); } catch { /* cancelado */ }
  };
  return (
    <div className="fx-page">
      <PageHead title={t('plus.yrTitle', { year })}>
        <button type="button" className="fx-btn" onClick={() => setYear(year - 1)}><Ic d={ICON.left} /></button>
        <button type="button" className="fx-btn" onClick={() => setYear(year + 1)}><Ic d={ICON.right} /></button>
      </PageHead>
      <Locked feature="yearReview">
        <div className="pm-wrapped">
          {cards.map(([label, value, sub]) => <div key={label} className="pm-wcard"><small>{label}</small><strong>{value}</strong>{sub && <span>{sub}</span>}</div>)}
        </div>
        <button type="button" className="fx-btn primary" onClick={share}>{t('plus.yrShareBtn')}</button>
      </Locked>
    </div>
  );
}

// ---------------------------------------------------------------- desafios
const CH_KEY = 'wallet.challenges';
const loadCh = (): Challenge[] => { try { return JSON.parse(localStorage.getItem(CH_KEY) || '[]'); } catch { return []; } };
const saveCh = (c: Challenge[]) => { try { localStorage.setItem(CH_KEY, JSON.stringify(c)); } catch { /* sem storage */ } };

export function ChallengesPage() {
  const { t } = useTranslation();
  const { txs, cats } = useData();
  const { money } = useMoney();
  const [list, setList] = useState<Challenge[]>(loadCh);
  const update = (next: Challenge[]) => { setList(next); saveCh(next); };
  const today = new Date().toISOString().slice(0, 10);
  const start = (type: ChallengeType) => update([...list, { id: newId(), type, startDate: today, weeksDone: [] }]);
  const toggleWeek = (ch: Challenge, w: number) => update(list.map((c) => c.id !== ch.id ? c : { ...c, weeksDone: c.weeksDone.includes(w) ? c.weeksDone.filter((x) => x !== w) : [...c.weeksDone, w] }));
  const types = Object.keys(CHALLENGE_DEFS) as ChallengeType[];
  return (
    <div className="fx-page">
      <PageHead title={t('plus.chTitle')} />
      <Locked feature="challenges">
        <div className="pm-tools">
          {types.map((ty) => (
            <button key={ty} type="button" className="pm-tool" disabled={list.some((c) => c.type === ty && evaluateChallenge(c, txs, cats).status === 'active')} onClick={() => start(ty)}>
              <b>{t('plus.ch_' + ty)}</b><small>{t('plus.chDesc_' + ty)}</small><span className="pm-chip">+ {t('plus.chStart')}</span>
            </button>
          ))}
        </div>
        <div className="pm-list">
          {[...list].reverse().map((ch) => {
            const st = evaluateChallenge(ch, txs, cats);
            return (
              <div key={ch.id} className={'fx-card pm-ch ' + st.status}>
                <div className="pm-irs-top"><b>{t('plus.ch_' + ch.type)}</b><span className={'pm-chip ' + st.status}>{t('plus.chStatus_' + st.status)}</span></div>
                <div className="pm-bar"><i style={{ width: `${Math.round(st.progress * 100)}%` }} /></div>
                <small className="fx-muted">{ch.type === 'week52' ? t('plus.chSaved', { v: money(st.savedCents) }) : t('plus.chUntil', { date: st.endDate.split('-').reverse().join('/'), v: money(st.spentCents) })}</small>
                {ch.type === 'week52' && (
                  <div className="pm-weeks">{Array.from({ length: 52 }, (_, i) => i + 1).map((w) => (
                    <button key={w} type="button" className={ch.weeksDone.includes(w) ? 'on' : ''} onClick={() => toggleWeek(ch, w)} aria-label={t('plus.chWeek', { n: w })}>{w}</button>
                  ))}</div>
                )}
                <button type="button" className="fx-link" onClick={() => update(list.filter((c) => c.id !== ch.id))}>{t('common.delete')}</button>
              </div>
            );
          })}
        </div>
      </Locked>
    </div>
  );
}

// ---------------------------------------------------------------- garantias
export function WarrantiesPage() {
  const { t } = useTranslation();
  const { money } = useMoney();
  const [items, setItems] = useState<Warranty[]>([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', purchaseDate: new Date().toISOString().slice(0, 10), months: '36', store: '', price: '' });
  const refresh = async () => setItems((await db.warranties.toArray()).filter((w) => w.deletedAt === null).sort((a, b) => warrantyEnd(a.purchaseDate, a.months).localeCompare(warrantyEnd(b.purchaseDate, b.months))));
  useEffect(() => { refresh().catch(() => {}); }, []);
  const missing = useMissing();
  const miss = missing([['name', L('o nome'), !!f.name.trim()], ['date', L('a data'), !!f.purchaseDate]]);
  const closeAdd = () => { setOpen(false); miss.reset(); };
  const save = async () => {
    if (!miss.check()) return;
    await db.warranties.add(stampNew<Warranty>({ name: f.name.trim(), purchaseDate: f.purchaseDate, months: Math.max(1, Number(f.months) || 24), store: f.store.trim(), note: '', priceCents: parseMoneyToCents(f.price) ?? 0 }));
    setOpen(false); setF({ ...f, name: '', store: '', price: '' }); await refresh();
  };
  const remove = async (id: string) => { await db.warranties.update(id, { deletedAt: new Date().toISOString() }); await refresh(); };
  return (
    <div className="fx-page">
      <PageHead title={t('plus.wTitle')}>
        {hasFeature('warranties') && <button type="button" className="fx-btn primary" onClick={() => setOpen(true)}><Ic d={ICON.plus} /> {t('plus.wAdd')}</button>}
      </PageHead>
      <Locked feature="warranties">
        {items.length === 0 ? <EmptyState icon={ICON.check} title={t('plus.wEmpty')} sub={t('plus.wEmptySub')} /> : (
          <div className="pm-list">
            {items.map((w) => {
              const left = warrantyDaysLeft(w.purchaseDate, w.months);
              return (
                <div key={w.id} className="fx-card pm-sub">
                  <div className="pm-sub-main"><b>{w.name}</b><small className="fx-muted">{[w.store, w.priceCents ? money(w.priceCents) : '', t('plus.wUntil', { date: warrantyEnd(w.purchaseDate, w.months).split('-').reverse().join('/') })].filter(Boolean).join(' · ')}</small></div>
                  <div className="pm-sub-right">
                    <span className={'pm-chip' + (left < 0 ? ' lost' : left <= 60 ? ' warn' : '')}>{left < 0 ? t('plus.wExpired') : t('plus.wLeft', { count: left })}</span>
                    <button type="button" className="fx-link" onClick={() => remove(w.id)}>{t('common.delete')}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Locked>
      <Sheet open={open} onClose={closeAdd} title={t('plus.wAdd')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={closeAdd}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={save}>{t('common.add')}</button></>}>
        {miss.note}
        <Field label={t('plus.wName')} miss={miss.cls('name')}><input className="fx-input" value={f.name} placeholder={t('plus.wNamePh')} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="fx-two">
          <Field label={t('plus.wDate')} miss={miss.cls('date')}><DatePicker value={f.purchaseDate} onChange={(v) => setF({ ...f, purchaseDate: v })} /></Field>
          <Field label={t('plus.wMonths')}><input className="fx-input" inputMode="numeric" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field>
        </div>
        <div className="fx-two">
          <Field label={t('plus.wStore')}><input className="fx-input" value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })} /></Field>
          <Field label={t('plus.wPrice')}><input className="fx-input" inputMode="decimal" value={f.price} placeholder="0,00" onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- independentes (Pro)
export function FreelancePage() {
  const { t } = useTranslation();
  const { txs, cats } = useData();
  const { money } = useMoney();
  const [year, setYear] = useState(new Date().getFullYear());
  const [biz, setBiz] = useState<Set<string>>(new Set());
  useEffect(() => { db.txTags.toArray().then((r) => setBiz(new Set(r.filter((x) => x.business && x.deletedAt === null).map((x) => x.id)))).catch(() => {}); }, []);
  const toggle = async (id: string) => {
    const on = !biz.has(id);
    const existing = await db.txTags.get(id);
    if (existing) await db.txTags.update(id, { business: on, updatedAt: new Date().toISOString() });
    else await db.txTags.add({ ...stampNew({ business: on }), id });
    const next = new Set(biz); if (on) next.add(id); else next.delete(id); setBiz(next);
  };
  const quarters = businessQuarters(txs, biz, year);
  const yearTx = txs.filter((x) => x.date.startsWith(String(year))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200);
  const catName = (id: string) => { const c = cats.find((x) => x.id === id); return c ? catLabel(t, c) : ''; };
  const exportCsv = () => {
    trackEvent('export');
    const blob = new Blob(['﻿' + businessCsv(txs, biz, catName, year)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `futurepal-profissional-${year}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="fx-page">
      <PageHead title={t('plus.fTitle')}>
        {hasFeature('freelance') && <button type="button" className="fx-btn" onClick={exportCsv}>{t('plus.fExport')}</button>}
      </PageHead>
      <Locked feature="freelance">
        <div className="pm-row">
          <button type="button" className="fx-btn" onClick={() => setYear(year - 1)}><Ic d={ICON.left} /></button>
          <b className="pm-year">{year}</b>
          <button type="button" className="fx-btn" onClick={() => setYear(year + 1)}><Ic d={ICON.right} /></button>
        </div>
        <div className="pm-wrapped">
          {quarters.map((q) => (
            <div key={q.quarter} className="pm-wcard"><small>{t('plus.fQuarter', { n: q.quarter })}</small><strong>{money(q.incomeCents - q.expenseCents)}</strong>
              <span>{t('plus.fQLine', { inc: money(q.incomeCents), exp: money(q.expenseCents) })}</span></div>
          ))}
        </div>
        <p className="fx-muted fx-small">{t('plus.fHint')}</p>
        <div className="pm-list">
          {yearTx.map((x) => (
            <label key={x.id} className="fx-card pm-sub pm-click">
              <input type="checkbox" checked={biz.has(x.id)} onChange={() => toggle(x.id)} />
              <div className="pm-sub-main"><b>{x.description || catName(x.categoryId)}</b><small className="fx-muted">{x.date.split('-').reverse().join('/')} · {catName(x.categoryId)}</small></div>
              <b className={x.type === 'income' ? 'fx-pos' : ''}>{(x.type === 'income' ? '+' : '−') + money(x.amountCents)}</b>
            </label>
          ))}
        </div>
      </Locked>
    </div>
  );
}
