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
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './ui/theme.css';
import './ui/finity.css';
import './ui/mobile.css';
import { loadSettings, setTheme } from './core/settings';
import { prepareDemo } from './demo/demo';

prepareDemo(); // modo demonstração do website: língua, setup feito, sem tutorial
const settings = loadSettings();

i18n.use(initReactI18next).init({
  resources: {
    'pt-PT': { translation: ptPT },
    'pt-BR': { translation: ptBR },
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
  },
  lng: settings.language,
  // Textos novos ainda só em PT/EN: es e fr caem para inglês, o resto para português.
  fallbackLng: { es: ['en'], fr: ['en'], default: ['pt-PT'] },
  interpolation: { escapeValue: false },
});

setTheme(settings.theme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
