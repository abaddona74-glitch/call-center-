import { countArray, notMigratedMapper } from './not-implemented.js';

/**
 * Legacy `data/telegram_subscribers.json`. Not migrated — owner decision 2026-11-18
 * (docs/rewrite/DECISIONS.md, "Перенос данных legacy"): subscribers are not carried over.
 * The count stays in the report.
 */
export const telegramSubscribersMapper = notMigratedMapper(
  { name: 'telegram-subscribers', owner: 'stage 2' },
  { jsonFiles: [{ file: 'telegram_subscribers.json', count: countArray() }] },
  'owner decision 2026-11-18 — Telegram subscribers are not carried over',
);
