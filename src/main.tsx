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
import './ui/pc-mobile.css';
import { loadSettings, setTheme } from './core/settings';
import { prepareDemo } from './demo/demo';
import { setupAndroidBack } from './core/androidBack';

setupAndroidBack();
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

// a página diz em que língua está (leitores de ecrã, corretor e tradutor do navegador)
document.documentElement.lang = settings.language;
i18n.on('languageChanged', (l) => { document.documentElement.lang = l; });

// App de Windows: barra do título própria (arrastar a janela) por baixo dos botões do sistema
if ((window as unknown as { __electronBridge?: unknown }).__electronBridge) {
  document.documentElement.classList.add('is-electron');
  const bar = document.createElement('div');
  bar.className = 'win-titlebar';
  bar.innerHTML = '<span>FuturePal</span>';
  document.body.prepend(bar);
}
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
