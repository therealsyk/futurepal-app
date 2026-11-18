import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Rail from './ui/Rail';
import MobileNav from './ui/MobileNav';
import { UpdateNotice } from './ui/UpdateNotice';
import { Dashboard, Transactions, Budgets, Goals, Salaries, Categories } from './pages';
import { Accounts } from './pages/Accounts';
import { Overview } from './pages/Overview';
import Calendar from './pages/Calendar';
import DayDetail from './pages/DayDetail';
import { Settings } from './pages/Settings';
import { MobileHome } from './pages/MobileHome';
import { useIsMobile } from './ui/useIsMobile';
import { DemoPage } from './ui/components';
import SetupWizard, { ONBOARDED_FLAG } from './pages/SetupWizard';
import { db } from './db/app-db';
import { ensureDefaultCategories, addMissingCatalogCategories } from './core/finance';
import { loadSettings, setTheme, type AppSettings } from './core/settings';
import { useAuth } from './auth/AuthContext';
import { getSupabase } from './auth/supabase';
import { runSync } from './sync/runSync';
import { mirrorSettings } from './core/settingsSync';
import { SETTINGS_EVENT } from './core/settings';

export default function App() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [toast, setToast] = useState(false);
  const isMobile = useIsMobile();

  // Categorias padrão (instalação nova) e as do catálogo que faltem (instalações antigas).
  // As páginas só aparecem depois disto, para nenhuma abrir com a lista de categorias vazia.
  const [catsReady, setCatsReady] = useState(false);
  useEffect(() => {
    ensureDefaultCategories(db).then(() => addMissingCatalogCategories(db)).catch(() => {}).finally(() => setCatsReady(true));
  }, []);

  // Cada mudança das definições (saveSettings) é copiada para a tabela sincronizada.
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<AppSettings>).detail;
      if (next?.country) mirrorSettings(db, next).catch(() => {});
    };
    window.addEventListener(SETTINGS_EVENT, onChange);
    const cur = loadSettings();
    if (cur.country) mirrorSettings(db, cur).catch(() => {}); // migra instalações antigas para a linha única
    return () => window.removeEventListener(SETTINGS_EVENT, onChange);
  }, []);

  // Com sessão iniciada, sincroniza em silêncio ao abrir a app (local-first: se falhar, nada se perde).
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !auth.user || !settings.country) return;
    runSync(sb, db, auth.user.id)
      .then((r) => { if (r.settings) setSettings(r.settings); })
      .catch(() => {});
  }, [auth.user?.id, settings.country]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cada página abre no topo (sem isto ficava a posição do scroll da página anterior).
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  // "Está tudo pronto!" depois do setup.
  useEffect(() => {
    if (!settings.country) return;
    let flag = false;
    try { flag = sessionStorage.getItem(ONBOARDED_FLAG) === '1'; sessionStorage.removeItem(ONBOARDED_FLAG); } catch { /* sem storage */ }
    if (!flag) return;
    setToast(true);
    const id = setTimeout(() => setToast(false), 3500);
    return () => clearTimeout(id);
  }, [settings.country]);

  if (!settings.country) {
    return (
      <>
        <SetupWizard onDone={(next) => { setTheme(next.theme); setSettings(next); }} />
        <UpdateNotice />
      </>
    );
  }

  if (!catsReady) return <div className="app-shell" aria-busy="true" />;

  return (
    <div className="app-shell">
      <Rail />
      <main className="app-main">
        <Routes>
          <Route path="/" element={isMobile ? <MobileHome /> : <Dashboard />} />
          <Route path="/painel" element={<Dashboard />} />
          <Route path="/contas" element={<Accounts />} />
          <Route path="/visao-mensal" element={<Overview />} />
          <Route path="/calendario" element={<Calendar />} />
          <Route path="/dia/:date" element={<DayDetail />} />
          <Route path="/transacoes" element={<Transactions />} />
          <Route path="/orcamentos" element={<Budgets />} />
          <Route path="/metas" element={<Goals />} />
          <Route path="/salarios" element={<Salaries />} />
          <Route path="/categorias" element={<Categories />} />
          <Route path="/definicoes" element={<Settings />} />
          {import.meta.env.DEV && <Route path="/demo" element={<DemoPage />} />}
        </Routes>
      </main>
      <MobileNav />
      <UpdateNotice />
      {toast && (
        <div className="mb-toast" role="status" onClick={() => setToast(false)}>
          <b>{t('onboard.doneTitle')}</b>
          <span>{t('onboard.doneSub')}</span>
        </div>
      )}
    </div>
  );
}
