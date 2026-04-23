import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './i18n/en.json';
import tr from './i18n/tr.json';
import es from './i18n/es.json';

const saved = localStorage.getItem('locale') || 'en';

i18n.use(initReactI18next).init({
  resources: { en: { t: en }, tr: { t: tr }, es: { t: es } },
  lng: saved,
  fallbackLng: 'en',
  defaultNS: 't',
  interpolation: { escapeValue: false },
});

export default i18n;
