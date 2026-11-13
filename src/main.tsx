import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptPT from './i18n/pt-PT.json';
import App from './App';
import './ui/theme.css';

i18n.use(initReactI18next).init({
  resources: {
    'pt-PT': { translation: ptPT },
  },
  lng: 'pt-PT',
  fallbackLng: 'pt-PT',
  interpolation: { escapeValue: false },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
