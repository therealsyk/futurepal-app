// Primeira utilização: o que a pessoa já fez, dicas por mostrar e contagens anónimas (só números, nunca valores nem nomes).
import { getSupabase } from '../auth/supabase';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem storage */ } };
export const TIPS_EVENT = 'wallet:tips';
const changed = () => { window.dispatchEvent(new Event(TIPS_EVENT)); };

/** Conta um passo (tabela onboarding_daily). Sem a migração no servidor, não faz nada. */
export function track(event: string): void {
  try { getSupabase()?.rpc('track_onboarding', { p_event: event }).then(() => {}, () => {}); } catch { /* sem rede */ }
}

export type Goal1 = 'expenses' | 'goal' | 'split' | 'save';
export function startOnboarding(): void { if (!get('wallet.ob.start')) { set('wallet.ob.start', String(Date.now())); track('start'); } }
export function chooseGoal(g: Goal1): void { set('wallet.ob.goal', g); track('goal_' + g); }
/** Ecrã mostrado: o último que aparece sem "done" é onde a pessoa desistiu. */
export const screen = (s: string): void => track('screen_' + s);
export function finishOnboarding(signedIn: boolean): void {
  set('wallet.fresh', '1'); set('wallet.tips', 'on'); set('wallet.tutorialSeen', '1'); set('wallet.guide', 'acc'); // a seguir, o guia passo a passo
  track('done'); if (signedIn) track('account');
}

export type Mile = 'expense' | 'income' | 'goal' | 'group' | 'limit' | 'account' | 'category' | 'recurring';
/** Primeira vez que se faz algo: conta uma só vez, com o tempo desde o início (em escalões). */
export function milestone(m: Mile): void {
  const k = 'wallet.ob.m.' + m;
  if (get(k)) return;
  set(k, '1');
  const t0 = Number(get('wallet.ob.start') || 0);
  if (t0) { const min = (Date.now() - t0) / 60000; track(`first_${m}_${min < 2 ? '2m' : min < 10 ? '10m' : min < 60 ? '1h' : min < 1440 ? '1d' : 'later'}`); }
  changed();
}
export const did = (m: Mile): boolean => !!get('wallet.ob.m.' + m);

/** Conta nova com poucos movimentos: o Início mostra só o essencial. */
export const isFresh = (): boolean => get('wallet.fresh') === '1';
export function growFrom(txCount: number): void { if (isFresh() && txCount >= 8) set('wallet.fresh', null); }

export const tipsOn = (): boolean => get('wallet.tips') === 'on';
const seen = (): string[] => { try { return JSON.parse(get('wallet.tipsSeen') || '[]') as string[]; } catch { return []; } };
export const tipSeen = (id: string): boolean => seen().includes(id);
export function closeTip(id: string, how: 'close' | 'do'): void { set('wallet.tipsSeen', JSON.stringify([...new Set([...seen(), id])])); track(`tip_${how}_${id}`); changed(); }
export function resetTips(): void { set('wallet.tips', 'on'); set('wallet.tipsSeen', null); changed(); }
