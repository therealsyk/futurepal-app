// Planos do FuturePal: Grátis, Plus, Família e Pro (independentes).
// Ainda sem pagamentos ligados: o plano fica guardado neste aparelho e a pessoa pode ativar um
// teste de 14 dias do Plus. Quando houver lojas/Paddle, só muda a origem do plano (ver activePlan).

export type PlanId = 'free' | 'plus' | 'family' | 'pro';
export type Feature =
  | 'unlimited' | 'irs' | 'subscriptions' | 'forecast' | 'yearReview' | 'challenges' | 'warranties'
  | 'shared' | 'split' | 'freelance' | 'assistant';

export const FREE_LIMITS = { accounts: 2, goals: 1, budgets: 3 } as const;

const PLUS: Feature[] = ['unlimited', 'irs', 'subscriptions', 'forecast', 'yearReview', 'challenges', 'warranties', 'assistant'];
export const PLAN_FEATURES: Record<PlanId, Feature[]> = {
  free: [],
  plus: PLUS,
  family: [...PLUS, 'shared', 'split'],
  pro: [...PLUS, 'freelance'],
};

export interface PlanState { plan: PlanId; trialEndsAt: string | null; trialUsed: boolean }
const KEY = 'wallet.plan';
export const PLAN_EVENT = 'wallet:plan';
const DEFAULT: PlanState = { plan: 'free', trialEndsAt: null, trialUsed: false };

export function loadPlan(): PlanState {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULT }; }
}
export function savePlan(next: PlanState): void {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sem storage */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_EVENT));
}

/** Plano em vigor: o teste do Plus conta como Plus até acabar. */
export function activePlan(s: PlanState = loadPlan(), now = new Date()): PlanId {
  if (s.plan !== 'free') return s.plan;
  if (s.trialEndsAt && new Date(s.trialEndsAt) > now) return 'plus';
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
