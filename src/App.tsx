import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './ui/Sidebar';
import { Panel, Calendar, Transactions, Budgets, Goals, Salaries } from './pages';
import { Settings } from './pages/Settings';
import { DemoPage } from './ui/components';
import SetupWizard from './pages/SetupWizard';
import { loadSettings, setTheme, type AppSettings } from './core/settings';

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings());

  if (!settings.country) {
    return <SetupWizard onDone={(next) => { setTheme(next.theme); setSettings(next); }} />;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Panel settings={settings} />} />
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
