import type { TFunction } from 'i18next';
import { isHttpError } from '@/shared/api';

/** Translate a users-admin API error (server messages are English and for logs). */
export function userErrorText(err: unknown, t: TFunction<'settings'>): string {
  if (isHttpError(err, 409)) {
    return err.body?.message.includes('superuser') ? t('users.errors.lastSuperuser') : t('users.errors.taken');
  }
  if (isHttpError(err, 403)) return t('users.errors.forbidden');
  if (isHttpError(err, 400)) {
    const m = err.body?.message ?? '';
    if (m.includes('extension')) return t('users.errors.extension');
    if (m.includes('password')) return t('users.errors.password');
    if (m.includes('username')) return t('users.errors.username');
    if (m.includes('email')) return t('users.errors.email');
  }
  return t('common.failed');
}
