import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import TopBar from './ui/TopBar';
import { Panel, Calendar, Transactions, Budgets, Goals, Salaries } from './pages';
import { Settings } from './pages/Settings';
import { DemoPage } from './ui/components';
import SetupWizard from './pages/SetupWizard';
import { db } from './db/app-db';
import { ensureDefaultCategories } from './core/finance';
import { loadSettings, setTheme, type AppSettings } from './core/settings';

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings());

  useEffect(() => {
    ensureDefaultCategories(db).catch(() => {});
  }, []);

  if (!settings.country) {
    return <SetupWizard onDone={(next) => { setTheme(next.theme); setSettings(next); }} />;
  }

  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Panel />} />
          <Route path="/calendario" element={<Calendar />} />
          <Route path="/transacoes" element={<Transactions />} />
          <Route path="/orcamentos" element={<Budgets />} />
          <Route path="/metas" element={<Goals />} />
          <Route path="/salarios" element={<Salaries />} />
          <Route path="/definicoes" element={<Settings />} />
          <Route path="/demo" element={<DemoPage />} />
        </Routes>
      </main>
    </div>
  );
}
