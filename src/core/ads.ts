// Anúncios: só no plano Grátis, nunca nos primeiros dias, no máximo 1 cartão "Patrocinado" por página.
// Android: faixa do Google AdMob enquanto o cartão está visível. PC/website: anúncios da própria app (Plus/Pro).
import { activePlan } from './plan';

/** IDs do AdMob (não são segredos: vão dentro da app). */
export const ADMOB = {
  appId: 'ca-app-pub-9088918913439543~3509659610',
  nativeUnit: 'ca-app-pub-9088918913439543/3896672426', // "Nativo avançado" (ainda sem suporte no plugin)
  // Faixa: enquanto a app não estiver aprovada na Google Play, usa o ID de TESTE da Google.
  // Quando estiver: cria uma unidade "Faixa" no AdMob, mete o ID aqui e muda live para true.
  bannerUnit: 'ca-app-pub-3940256099942544/6300978111',
  live: false,
} as const;

const FIRST_USE_KEY = 'wallet.firstUse';
export const AD_GRACE_DAYS = 3;
/** Interruptor geral: false = sem anúncios em lado nenhum (está tudo pronto, só desligado). */
export const ADS_ENABLED = false;

/** Primeira vez que a app foi aberta neste aparelho (para não mostrar anúncios logo nos primeiros dias). */
export function firstUse(now = new Date()): Date {
  try {
    const v = localStorage.getItem(FIRST_USE_KEY);
    if (v) return new Date(v);
    localStorage.setItem(FIRST_USE_KEY, now.toISOString());
  } catch { /* sem storage */ }
  return now;
}

export function shouldShowAds(now = new Date()): boolean {
  if (!ADS_ENABLED) return false;
  if (import.meta.env.VITE_DEMO === '1') return false;
  if (activePlan() !== 'free') return false;
  return now.getTime() - firstUse(now).getTime() >= AD_GRACE_DAYS * 86_400_000;
}

/** Anúncios da própria app (rodam por dia e por sítio). */
export const HOUSE_ADS = [
  { key: 'trial', to: '/plus' },
  { key: 'receipts', to: '/plus' },
  { key: 'family', to: '/plus' },
  { key: 'noAds', to: '/plus' },
] as const;
export function pickHouseAd(place: string, now = new Date()) {
  const seed = Math.floor(now.getTime() / 86_400_000) + [...place].reduce((a, c) => a + c.charCodeAt(0), 0);
  return HOUSE_ADS[seed % HOUSE_ADS.length];
}
