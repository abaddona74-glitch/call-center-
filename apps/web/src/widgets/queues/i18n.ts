import { registerTranslations } from '@/shared/i18n';

registerTranslations('queues', {
  uz: {
    title: 'Navbatda kutayotganlar',
    count: '{{n}} ta',
    empty: "Hozircha navbatda kutayotganlar yo'q",
    queue: 'Navbat',
    position: 'Navbatda #{{n}}',
    waitTitle: 'Kutish vaqti',
  },
  ru: {
    title: 'Ожидают в очереди',
    count: '{{n}}',
    empty: 'Сейчас в очереди никого нет',
    queue: 'Очередь',
    position: 'В очереди #{{n}}',
    waitTitle: 'Время ожидания',
  },
});
