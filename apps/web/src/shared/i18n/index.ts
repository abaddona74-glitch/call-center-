import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';
import uz from './locales/uz.json';

export const LANGUAGES = ['uz', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'cc.lang';

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'uz' || saved === 'ru') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'uz';
}

void i18n.use(initReactI18next).init({
  resources: { uz: { translation: uz }, ru: { translation: ru } },
  lng: initialLanguage(),
  fallbackLng: 'uz',
  interpolation: { escapeValue: false }, // React escapes already
});

export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

/**
 * Each FSD slice keeps its own translations next to its code and registers them
 * under its own namespace, so slices never edit a shared locale file:
 *
 *   // src/pages/history/i18n.ts
 *   registerTranslations('history', { uz, ru });
 *   // in components
 *   const { t } = useTranslation('history');
 *
 * `shared/i18n/locales/*.json` (default namespace) holds only app-wide words.
 */
export function registerTranslations(ns: string, resources: Record<Language, Record<string, unknown>>): void {
  for (const lang of LANGUAGES) {
    i18n.addResourceBundle(lang, ns, resources[lang], true, true);
  }
}

export { i18n };
