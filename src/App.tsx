import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Rail from './ui/Rail';
import MobileNav from './ui/MobileNav';
import { UpdateNotice } from './ui/UpdateNotice';
import { MobileTutorial } from './ui/MobileTutorial';
import { Dashboard, Transactions, Budgets, Goals, Salaries, Categories } from './pages';
import { Accounts } from './pages/Accounts';
import { Overview } from './pages/Overview';
import Calendar from './pages/Calendar';
import DayDetail from './pages/DayDetail';
import { Settings } from './pages/Settings';
import { MobileHome } from './pages/MobileHome';
import { AdminPage } from './pages/Admin';
import { FamilyPage } from './pages/Family';
import { AssistantPage } from './pages/Assistant';
import { SplitPage } from './pages/Split';
import { PlusPage, IrsPage, SubscriptionsPage, YearPage, ChallengesPage, WarrantiesPage, FreelancePage } from './pages/Premium';
import { useIsMobile } from './ui/useIsMobile';
import { DemoPage } from './ui/components';
import SetupWizard, { ONBOARDED_FLAG } from './pages/SetupWizard';
import { db, activateDatabaseFor, guestDataCount, moveGuestDataIntoCurrent, DB_CHANGED_EVENT, currentDbName } from './db/app-db';
import { Sheet } from './ui/fx';
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

  // Uma base de dados local por conta: ao entrar/sair de uma conta, a app muda para a base dessa conta
  // (ou para a base sem conta). Depois disso garante as categorias e só então mostra as páginas.
  const [dbName, setDbName] = useState<string | null>(null);
  const [mergeCount, setMergeCount] = useState(0); // dados feitos sem conta, à espera da decisão da pessoa
  const [merging, setMerging] = useState(false);
  const userId = auth.user?.id ?? null;

  const syncNowSilently = (uid: string) => {
    const sb = getSupabase();
    if (!sb || !loadSettings().country) return;
    runSync(sb, db, uid).then((r) => { if (r.settings) setSettings(r.settings); }).catch(() => {});
  };

  useEffect(() => {
    if (!auth.ready) return;
    let alive = true;
    (async () => {
      const r = await activateDatabaseFor(userId);
      await ensureDefaultCategories(db);
      await addMissingCatalogCategories(db);
      const cur = loadSettings();
      if (cur.country) await mirrorSettings(db, cur).catch(() => {});
      if (!alive) return;
      setDbName(r.name);
      if (!userId) { setMergeCount(0); return; }
      const pending = r.firstTime ? await guestDataCount() : 0;
      if (pending > 0) setMergeCount(pending); // pergunta antes de sincronizar
      else syncNowSilently(userId);
    })().catch(() => setDbName(currentDbName()));
    return () => { alive = false; };
  }, [auth.ready, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Outra parte da app pode mudar de base (ex.: setup); acompanha para recarregar as páginas.
  useEffect(() => {
    const on = (e: Event) => setDbName((e as CustomEvent<string>).detail);
    window.addEventListener(DB_CHANGED_EVENT, on);
    return () => window.removeEventListener(DB_CHANGED_EVENT, on);
  }, []);

  async function decideMerge(bring: boolean) {
    setMerging(true);
    try {
      if (bring) await moveGuestDataIntoCurrent();
    } finally {
      setMerging(false);
      setMergeCount(0);
      setDbName(currentDbName() + (bring ? '#merged' : '')); // recarrega as páginas com os dados novos
      if (userId) syncNowSilently(userId);
    }
  }

  // Cada mudança das definições (saveSettings) é copiada para a tabela sincronizada da base ativa.
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<AppSettings>).detail;
      if (next?.country) mirrorSettings(db, next).catch(() => {});
    };
    window.addEventListener(SETTINGS_EVENT, onChange);
    return () => window.removeEventListener(SETTINGS_EVENT, onChange);
  }, []);

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

  if (!dbName) return <div className="app-shell" aria-busy="true" />;

  return (
    <div className="app-shell">
      <Rail />
      <main className="app-main" key={dbName}>
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
          <Route path="/plus" element={<PlusPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/irs" element={<IrsPage />} />
          <Route path="/subscricoes" element={<SubscriptionsPage />} />
          <Route path="/ano" element={<YearPage />} />
          <Route path="/desafios" element={<ChallengesPage />} />
          <Route path="/garantias" element={<WarrantiesPage />} />
          <Route path="/independentes" element={<FreelancePage />} />
          <Route path="/casa" element={<FamilyPage />} />
          <Route path="/assistente" element={<AssistantPage />} />
          <Route path="/dividir" element={<SplitPage />} />
          {import.meta.env.DEV && <Route path="/demo" element={<DemoPage />} />}
        </Routes>
      </main>
      <MobileNav />
      <MobileTutorial enabled={isMobile} />
      <UpdateNotice />
      <Sheet open={mergeCount > 0} onClose={() => { if (!merging) decideMerge(false); }} title={t('accountData.title')}>
        <p>{t('accountData.text', { count: mergeCount, email: auth.user?.email ?? '' })}</p>
        <p className="fx-muted fx-small">{t('accountData.note')}</p>
        <div className="ai-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="fx-btn" disabled={merging} onClick={() => decideMerge(false)} data-testid="merge-no">{t('accountData.keepApart')}</button>
          <button type="button" className="fx-btn primary" disabled={merging} onClick={() => decideMerge(true)} data-testid="merge-yes">{t('accountData.bring')}</button>
        </div>
      </Sheet>
      {toast && (
        <div className="mb-toast" role="status" onClick={() => setToast(false)}>
          <b>{t('onboard.doneTitle')}</b>
          <span>{t('onboard.doneSub')}</span>
        </div>
      )}
    </div>
  );
}
