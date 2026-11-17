import { countArray, notImplementedMapper } from './not-implemented.js';

/**
 * Legacy `data/telegram_subscribers.json` → telegram subscribers table (stage 2, Telegram notifications).
 *
 * TODO(stage 2):
 * - `[{ chatId: string, username, firstName, lastName, subscribedAt: ISO }]` → `chat_id bigint PK`, names,
 *   `subscribed_at timestamptz` (ISO with Z, cast directly).
 * - ROADMAP: Telegram notifications get a chat whitelist — decide whether all subscribers are carried over.
 * - Idempotency: insert-if-absent by chat id.
 */
export const telegramSubscribersMapper = notImplementedMapper(
  { name: 'telegram-subscribers', owner: 'stage 2' },
  { jsonFiles: [{ file: 'telegram_subscribers.json', count: countArray() }] },
);
