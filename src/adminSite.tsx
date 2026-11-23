// Painel de administração do website: é o mesmo painel da app (mesmos componentes), sem o resto da app.
// Compilado com `npm run admin:build` para website/admin/.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptPT from './i18n/pt-PT.json';
import ptBR from './i18n/pt-BR.json';
import en from './i18n/en.json';
import es from './i18n/es.json';
import fr from './i18n/fr.json';
import { AuthProvider } from './auth/AuthContext';
import './ui/theme.css';
import './ui/finity.css';
import './ui/mobile.css';
import './ui/pc-mobile.css';
import { loadSettings, setTheme } from './core/settings';
import './core/uiMode';
import { AdminPage } from './pages/Admin';

const settings = loadSettings();
i18n.use(initReactI18next).init({
  resources: { 'pt-PT': { translation: ptPT }, 'pt-BR': { translation: ptBR }, en: { translation: en }, es: { translation: es }, fr: { translation: fr } },
  lng: settings.language,
  fallbackLng: { es: ['en'], fr: ['en'], default: ['pt-PT'] },
  interpolation: { escapeValue: false },
});
document.documentElement.lang = settings.language;
setTheme(settings.theme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <div className="app-shell adm-site"><AdminPage /></div>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
