// Planos do FuturePal: Grátis, Plus e Pro. Cada plano tem tudo o do anterior, e mais.
// (O antigo Família passou a fazer parte do Pro: quem o tinha fica com Pro.)
// Ainda sem pagamentos ligados: o plano fica guardado neste aparelho e a pessoa pode ativar um
// teste de 14 dias do Pro. Quando houver lojas/Paddle, só muda a origem do plano (ver activePlan).

export type PlanId = 'free' | 'plus' | 'pro';
export type Feature =
  | 'unlimited' | 'irs' | 'subscriptions' | 'forecast' | 'yearReview' | 'challenges' | 'warranties'
  | 'shared' | 'split' | 'freelance' | 'assistant';

export const FREE_LIMITS = { accounts: 2, goals: 1, budgets: 3 } as const;

const PLUS: Feature[] = ['unlimited', 'irs', 'subscriptions', 'forecast', 'yearReview', 'challenges', 'warranties', 'assistant', 'split'];
export const PLAN_FEATURES: Record<PlanId, Feature[]> = {
  free: [],
  plus: PLUS,
  pro: [...PLUS, 'shared', 'freelance'],
};

/** Preços em cêntimos (mensal e anual; o anual = 10 meses, ou seja 2 meses grátis). */
export const PRICES: Record<Exclude<PlanId, 'free'>, { month: number; year: number }> = {
  plus: { month: 299, year: 2999 },
  pro: { month: 599, year: 5999 },
};
/** Quotas do Assistente por mês (a Edge Function ai-ask aplica as mesmas). */
export const AI_QUOTA: Record<Exclude<PlanId, 'free'>, { questions: number; photos: number }> = {
  plus: { questions: 100, photos: 30 },
  pro: { questions: 300, photos: 100 },
};

export interface PlanState { plan: PlanId; trialEndsAt: string | null; trialUsed: boolean }
export const PLAN_EVENT = 'wallet:plan';
// O plano é guardado por conta: uma conta nova neste aparelho começa sempre no Grátis.
let owner = 'guest';
export function setPlanOwner(userId: string | null): void {
  const next = userId || 'guest';
  if (next === owner) return;
  owner = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_EVENT));
}
const keyOf = () => 'wallet.plan:' + owner;
const DEFAULT: PlanState = { plan: 'free', trialEndsAt: null, trialUsed: false };

export function loadPlan(): PlanState {
  try {
    const s = { ...DEFAULT, ...JSON.parse(localStorage.getItem(keyOf()) || '{}') } as Omit<PlanState, 'plan'> & { plan: string };
    return { ...s, plan: s.plan === 'family' ? 'pro' : (s.plan as PlanId) }; // 'family' = plano antigo
  } catch { return { ...DEFAULT }; }
}
export function savePlan(next: PlanState): void {
  try { localStorage.setItem(keyOf(), JSON.stringify(next)); } catch { /* sem storage */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_EVENT));
}

/** Plano em vigor: o teste conta como Pro até acabar. */
export function activePlan(s: PlanState = loadPlan(), now = new Date()): PlanId {
  if (s.plan !== 'free') return s.plan;
  if (s.trialEndsAt && new Date(s.trialEndsAt) > now) return 'pro';
  return 'free';
}
export function hasFeature(f: Feature, s: PlanState = loadPlan(), now = new Date()): boolean {
  return PLAN_FEATURES[activePlan(s, now)].includes(f);
}
export function trialDaysLeft(s: PlanState = loadPlan(), now = new Date()): number {
  if (!s.trialEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(s.trialEndsAt).getTime() - now.getTime()) / 86_400_000));
}
export function startTrial(days = 14, now = new Date()): PlanState {
  const s = loadPlan();
  if (s.trialUsed) return s;
  const next = { ...s, trialUsed: true, trialEndsAt: new Date(now.getTime() + days * 86_400_000).toISOString() };
  savePlan(next);
  return next;
}
/** Dentro do limite do plano grátis? (contas, metas, orçamentos) */
export function withinFreeLimit(kind: keyof typeof FREE_LIMITS, currentCount: number): boolean {
  return hasFeature('unlimited') || currentCount < FREE_LIMITS[kind];
}

/**
 * Aplica a subscrição do servidor (tabela subscriptions) a este aparelho.
 * Ativa -> esse plano. Sem linha ou expirada -> Grátis (o teste de 14 dias, se houver, continua a contar).
 * Em modo de desenvolvimento não mexe, para o seletor de planos de teste continuar a funcionar.
 */
export function applyServerPlan(row: { plan: string; status: string; current_period_end: string } | null, now = new Date()): void {
  if (import.meta.env?.DEV) return;
  const s = loadPlan();
  const active = !!row && ['active', 'trialing'].includes(row.status) && new Date(row.current_period_end) > now
    && ['plus', 'family', 'pro'].includes(row.plan);
  const plan: PlanId = !active ? 'free' : row!.plan === 'plus' ? 'plus' : 'pro'; // 'family' (antigo) = Pro
  if (plan !== s.plan) savePlan({ ...s, plan });
}
