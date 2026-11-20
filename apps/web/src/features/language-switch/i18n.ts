import { registerTranslations } from '@/shared/i18n';

// The label names the language the click switches to, in that language's own words for clarity.
registerTranslations('languageSwitch', {
  uz: {
    to_uz: "O'zbek tiliga o'tish",
    to_ru: 'Rus tiliga o‘tish (Русский)',
  },
  ru: {
    to_uz: 'Переключить на узбекский (O‘zbekcha)',
    to_ru: 'Переключить на русский',
  },
});
