import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ADMOB, pickHouseAd, shouldShowAds } from '../core/ads';
import { PLAN_EVENT } from '../core/plan';

const isAndroidNative = () => {
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  return !!c?.isNativePlatform?.() && c.getPlatform?.() === 'android';
};

// AdMob (Android): inicializa uma vez, pede o consentimento (RGPD) e mostra/esconde a faixa.
let admobReady: Promise<typeof import('@capacitor-community/admob') | null> | null = null;
function admob() {
  if (!admobReady) {
    admobReady = (async () => {
      try {
        const mod = await import('@capacitor-community/admob');
        await mod.AdMob.initialize({ initializeForTesting: !ADMOB.live });
        const info = await mod.AdMob.requestConsentInfo();
        if (info.isConsentFormAvailable && info.status === mod.AdmobConsentStatus.REQUIRED) await mod.AdMob.showConsentForm();
        return mod;
      } catch { return null; }
    })();
  }
  return admobReady;
}
let bannerOn = false;
async function showBanner() {
  const mod = await admob();
  if (!mod || bannerOn) return;
  bannerOn = true;
  try {
    await mod.AdMob.showBanner({
      adId: ADMOB.bannerUnit,
      adSize: mod.BannerAdSize.ADAPTIVE_BANNER,
      position: mod.BannerAdPosition.BOTTOM_CENTER,
      margin: 96, // por cima da barra de navegação
      isTesting: !ADMOB.live,
      npa: true, // anúncios não personalizados: não usam os dados da pessoa
    });
  } catch { bannerOn = false; }
}
async function hideBanner() {
  if (!bannerOn) return;
  bannerOn = false;
  const mod = await admob();
  try { await mod?.AdMob.removeBanner(); } catch { /* nada */ }
}

/** Cartão "Patrocinado" discreto (1 por página). Só no plano Grátis e depois dos primeiros dias. */
export function Sponsored({ place }: { place: string }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(shouldShowAds());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = () => setShow(shouldShowAds());
    window.addEventListener(PLAN_EVENT, on);
    return () => window.removeEventListener(PLAN_EVENT, on);
  }, []);
  // Android: a faixa do AdMob aparece só enquanto este cartão está no ecrã
  useEffect(() => {
    if (!show || !isAndroidNative() || !ref.current) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) showBanner(); else hideBanner(); }, { threshold: 0.6 });
    io.observe(ref.current);
    return () => { io.disconnect(); hideBanner(); };
  }, [show]);
  if (!show) return null;
  const ad = pickHouseAd(place);
  return (
    <div className="ad-card" ref={ref} data-testid="sponsored">
      <span className="ad-tag">{t('ads.tag')}</span>
      <Link to={ad.to} className="ad-body">
        <b>{t(`ads.${ad.key}Title`)}</b>
        <small>{t(`ads.${ad.key}Text`)}</small>
      </Link>
    </div>
  );
}
