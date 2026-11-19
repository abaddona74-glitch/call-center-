import { z } from 'zod';
import { UzPhoneInputSchema } from './callbacks.js';
import { IsoDateSchema } from './common.js';

/** Phonebook / CRM of citizens, keyed by the normalized phone (replaces legacy `client_contacts`). */

export const CONTACT_LANGUAGES = ['uz', 'ru', 'en', 'other'] as const;
export const ContactLanguageSchema = z.enum(CONTACT_LANGUAGES);
export type ContactLanguage = z.infer<typeof ContactLanguageSchema>;

const IsoDateTime = z.iso.datetime({ offset: true });
const NO_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !NO_CONTROL.test(v), 'Control characters are not allowed');

/** Numeric Telegram user id or @username. */
export const TelegramHandleSchema = z
  .string()
  .trim()
  .regex(/^(@[A-Za-z][A-Za-z0-9_]{4,31}|[0-9]{5,15})$/, 'Telegram: numeric id or @username');

export const ContactSchema = z.object({
  phone: z.string(),
  name: z.string(),
  organization: z.string(),
  language: ContactLanguageSchema.nullable(),
  note: z.string(),
  telegram: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Contact = z.infer<typeof ContactSchema>;

export const ContactInputSchema = z
  .object({
    phone: UzPhoneInputSchema,
    name: text(120).default(''),
    organization: text(200).default(''),
    language: ContactLanguageSchema.nullable().default(null),
    note: text(1000).default(''),
    telegram: z.union([TelegramHandleSchema, z.literal('').transform(() => null), z.null()]).default(null),
  })
  .refine((c) => c.name !== '' || c.organization !== '' || c.telegram !== null, {
    message: 'Name, organization or Telegram is required',
    path: ['name'],
  });
export type ContactInput = z.input<typeof ContactInputSchema>;
export type ContactInputParsed = z.infer<typeof ContactInputSchema>;

export const ContactListQuerySchema = z.object({
  /** Free text: name, organization, note or phone digits. */
  q: z.string().trim().max(100).optional(),
  /** A language or `none` (not set). */
  language: z.union([ContactLanguageSchema, z.literal('none')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(2000),
});
export type ContactListQuery = z.infer<typeof ContactListQuerySchema>;

export const ContactListResponseSchema = z.object({
  items: z.array(ContactSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ContactListResponse = z.infer<typeof ContactListResponseSchema>;

/** What the current user may do with contacts (decided on the server from the session's permissions). */
export const ContactAccessSchema = z.object({ canView: z.boolean(), canEdit: z.boolean() });
export type ContactAccess = z.infer<typeof ContactAccessSchema>;

export const TopActiveQuerySchema = z.object({
  /** `today`, `week` (last 7 days), `month` (last 30 days) or one date. */
  date: z.union([z.literal('today'), z.literal('week'), z.literal('month'), IsoDateSchema]).default('today'),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});
export type TopActiveQuery = z.infer<typeof TopActiveQuerySchema>;

export const TopActiveClientSchema = z.object({
  phone: z.string(),
  totalCalls: z.number().int(),
  answeredCalls: z.number().int(),
  totalTalkSeconds: z.number().int(),
  lastCallAt: IsoDateTime,
  contact: ContactSchema.nullable(),
});
export type TopActiveClient = z.infer<typeof TopActiveClientSchema>;

export const TopActiveResponseSchema = z.object({ items: z.array(TopActiveClientSchema) });
export type TopActiveResponse = z.infer<typeof TopActiveResponseSchema>;
