import type { Mapper } from '../mapper.js';
import { blacklistMapper } from './blacklist.mapper.js';
import { callbacksMapper } from './callbacks.mapper.js';
import { contactsMapper } from './contacts.mapper.js';
import { excludedOperatorsMapper } from './excluded-operators.mapper.js';
import { passkeysMapper } from './passkeys.mapper.js';
import { remoteDesktopDevicesMapper } from './remote-desktop-devices.mapper.js';
import { settingsMapper } from './settings.mapper.js';
import { telegramSubscribersMapper } from './telegram-subscribers.mapper.js';
import { ticketsMapper } from './tickets.mapper.js';
import { transcriptsMapper } from './transcripts.mapper.js';
import { usersMapper } from './users.mapper.js';

/** Run order matters: users first (passkeys and others resolve users by username). */
export const ALL_MAPPERS: readonly Mapper[] = [
  usersMapper,
  passkeysMapper,
  settingsMapper,
  excludedOperatorsMapper,
  contactsMapper,
  callbacksMapper,
  blacklistMapper,
  transcriptsMapper,
  ticketsMapper,
  telegramSubscribersMapper,
  remoteDesktopDevicesMapper,
];
