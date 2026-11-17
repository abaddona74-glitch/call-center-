import type { MailMessage } from './mail.service.js';

/** Code emails, bilingual (Uzbek first, like the UI default). Plain text only. */
export type CodeMailPurpose = 'password_reset' | 'email_current' | 'email_new';

const SUBJECTS: Record<CodeMailPurpose, string> = {
  password_reset: 'Parolni tiklash kodi / Код восстановления пароля',
  email_current: 'Emailni o‘zgartirishni tasdiqlang / Подтвердите смену email',
  email_new: 'Emailni tasdiqlash kodi / Код подтверждения email',
};

const LINES: Record<CodeMailPurpose, [uz: string, ru: string]> = {
  password_reset: [
    'Call Center hisobingiz parolini tiklash uchun kod',
    'Код для восстановления пароля учётной записи Call Center',
  ],
  email_current: [
    'Hisobingizdagi emailni o‘zgartirish yoki o‘chirishni tasdiqlash kodi',
    'Код для подтверждения смены или отвязки email в учётной записи',
  ],
  email_new: [
    'Ushbu emailni Call Center hisobingizga ulash uchun kod',
    'Код для привязки этого email к учётной записи Call Center',
  ],
};

export function codeMail(
  purpose: CodeMailPurpose,
  to: string,
  username: string,
  code: string,
  ttlMinutes: number,
): MailMessage {
  const [uz, ru] = LINES[purpose];
  const text = [
    `${uz} (${username}): ${code}`,
    `Kod ${ttlMinutes} daqiqa amal qiladi. Agar bu siz bo‘lmasangiz, xabarni e’tiborsiz qoldiring.`,
    '',
    `${ru} (${username}): ${code}`,
    `Код действует ${ttlMinutes} минут. Если это были не вы, просто проигнорируйте письмо.`,
  ].join('\n');
  return { to, subject: SUBJECTS[purpose], text };
}
