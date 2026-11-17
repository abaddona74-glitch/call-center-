import {
  CONTACT_LANGUAGES,
  type Contact,
  type ContactInput,
  ContactInputSchema,
  type ContactLanguage,
} from '@cc/shared';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, FileText, Send } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { contactKeys, deleteContact, saveContact, telegramByPhoneUrl, telegramUrl } from '@/entities/contact';
import { isHttpError } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { DangerConfirmDialog } from '@/shared/ui/danger-confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { Icon } from '@/shared/ui/icon';

interface FormValues {
  phone: string;
  name: string;
  organization: string;
  telegram: string;
  language: ContactLanguage | '';
  note: string;
}

function toInput(v: FormValues): ContactInput {
  return {
    phone: v.phone,
    name: v.name,
    organization: v.organization,
    telegram: v.telegram.trim() || null,
    language: v.language || null,
    note: v.note,
  };
}

const inputClass =
  'w-full rounded-lg border border-white/15 bg-sidebar/80 px-3.5 py-2.5 text-[13.5px] text-white outline-none transition-all duration-200 placeholder:text-slate-500 focus:border-primary/60 aria-invalid:border-destructive';

function FieldLabel({ icon, children, hint }: { icon: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <label
      className={cn(
        'mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500',
        hint && 'justify-between',
      )}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        {children}
      </span>
      {hint && <span className="text-[11px] font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

function FieldError({ errors }: { errors: unknown[] }) {
  const msg = errors.find((e): e is string => typeof e === 'string');
  return msg ? <p className="mt-1 text-[11.5px] text-red-400">{msg}</p> : null;
}

/**
 * Add / edit client (legacy #adminClientModal). Editing may change the phone: the server moves the
 * contact. Validation is the shared zod schema; server messages are shown as they are.
 */
export function ContactDialog({
  open,
  onOpenChange,
  contact,
  presetPhone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = add mode */
  contact: Contact | null;
  presetPhone?: string;
}) {
  const { t } = useTranslation('contactsEdit');
  const { t: tl } = useTranslation('contact');
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const form = useForm({
    defaultValues: {
      phone: contact?.phone ?? presetPhone ?? '',
      name: contact?.name ?? '',
      organization: contact?.organization ?? '',
      telegram: contact?.telegram ?? '',
      language: contact?.language ?? '',
      note: contact?.note ?? '',
    } as FormValues,
    validators: {
      onSubmit: ({ value }) => {
        const r = ContactInputSchema.safeParse(toInput(value));
        if (r.success) return undefined;
        return { fields: Object.fromEntries(r.error.issues.map((i) => [String(i.path[0] ?? 'phone'), i.message])) };
      },
    },
    onSubmit: async ({ value }) => {
      setServerError(null);
      try {
        await saveContact(toInput(value), contact?.phone);
        toast.success(t('saved'));
        await queryClient.invalidateQueries({ queryKey: contactKeys.all });
        onOpenChange(false);
      } catch (err) {
        setServerError(isHttpError(err) ? (err.body?.message ?? err.message) : t('networkError', { msg: String(err) }));
      }
    },
  });

  const remove = async () => {
    if (!contact) return;
    setDeleting(true);
    try {
      await deleteContact(contact.phone);
      toast.success(t('deleted'));
      await queryClient.invalidateQueries({ queryKey: contactKeys.all });
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const openTelegram = (byPhone: boolean) => {
    const { phone, telegram } = form.state.values;
    const url = byPhone ? telegramByPhoneUrl(phone) : telegramUrl(telegram, phone);
    if (!url) {
      toast.warning(byPhone ? t('tg.noPhone') : t('tg.nothing'));
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const copyTelegram = async () => {
    const { phone, telegram } = form.state.values;
    const v = telegram.trim() || phone.trim();
    if (!v) {
      toast.warning(t('tg.nothingToCopy'));
      return;
    }
    await navigator.clipboard.writeText(v).catch(() => undefined);
    toast.success(t('tg.copied', { v }));
  };

  const tgBtn =
    'inline-flex items-center gap-[5px] rounded-md border px-[9px] py-1 text-[11px] font-semibold transition-all duration-150';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[92vh] w-[520px] max-w-[95vw] gap-0 overflow-y-auto rounded-2xl border-primary/40 bg-sidebar p-0 shadow-[0_24px_60px_rgba(0,0,0,0.85),0_0_30px_rgba(99,102,241,0.15)] sm:max-w-[520px]"
        >
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-sidebar/95 px-6 py-[18px]">
            <div className="flex items-center gap-3">
              <div className="flex size-[38px] items-center justify-center rounded-[10px] border border-primary/40 bg-primary/20 text-indigo-400">
                <Icon name="user" className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-white">
                  {contact ? t('editTitle') : t('addTitle')}
                </DialogTitle>
                <DialogDescription className="mt-[3px] text-[11.5px] text-slate-400">{t('subtitle')}</DialogDescription>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white"
              aria-label={t('cancel')}
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>

          <form
            className="px-6 py-[22px]"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="phone">
              {(field) => (
                <div className="mb-4">
                  <FieldLabel icon={<Icon name="call" className="size-3.5 text-sky-400" />}>
                    {t('phone')} <span className="text-red-400">*</span>
                  </FieldLabel>
                  <input
                    className={cn(inputClass, 'font-mono tracking-[0.5px]')}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="+998901234567"
                    autoFocus={!presetPhone && !contact}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="name">
              {(field) => (
                <div className="mb-4">
                  <FieldLabel icon={<Icon name="user" className="size-3.5 text-violet-400" />} hint={t('optional')}>
                    {t('name')}
                  </FieldLabel>
                  <input
                    className={inputClass}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t('namePlaceholder')}
                    autoFocus={Boolean(presetPhone)}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="organization">
              {(field) => (
                <div className="mb-4">
                  <FieldLabel icon={<Icon name="location" className="size-3.5 text-emerald-400" />} hint={t('orgHint')}>
                    {t('organization')}
                  </FieldLabel>
                  <input
                    className={inputClass}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t('orgPlaceholder')}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="telegram">
              {(field) => (
                <div className="mb-[18px] rounded-xl border border-sky-400/20 bg-sky-500/5 px-4 py-3.5">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[13px] font-bold text-sky-400">
                      <Send className="size-4" /> {t('tg.title')}
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        title={t('tg.byPhoneTitle')}
                        onClick={() => openTelegram(true)}
                        className={cn(tgBtn, 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400')}
                      >
                        <Icon name="call" className="size-3" /> {t('tg.byPhone')}
                      </button>
                      <button
                        type="button"
                        title={t('tg.openTitle')}
                        onClick={() => openTelegram(false)}
                        className={cn(tgBtn, 'border-sky-400/45 bg-sky-400/20 text-sky-400')}
                      >
                        {t('tg.open')} ↗
                      </button>
                      <button
                        type="button"
                        title={t('tg.copyTitle')}
                        onClick={() => void copyTelegram()}
                        className={cn(tgBtn, 'gap-1 border-white/15 bg-white/[0.06] px-2 font-normal text-slate-400')}
                      >
                        <Copy className="size-3" />
                      </button>
                    </div>
                  </div>
                  <input
                    className={cn(inputClass, 'border-sky-400/30 bg-sidebar/85 font-semibold text-sky-400')}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t('tg.placeholder')}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  <FieldError errors={field.state.meta.errors} />
                  <p className="mt-2 text-[11px] leading-[1.45] text-slate-400">
                    <span className="font-semibold text-sky-400">💡 {t('tg.noteTitle')}</span> {t('tg.note')}
                  </p>
                </div>
              )}
            </form.Field>

            <form.Field name="language">
              {(field) => (
                <div className="mb-4">
                  <FieldLabel icon={<Icon name="global" className="size-3.5 text-blue-400" />} hint={t('langHint')}>
                    {t('language')}
                  </FieldLabel>
                  <select
                    className={cn(inputClass, 'cursor-pointer bg-sidebar')}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value as FormValues['language'])}
                  >
                    <option value="">{t('langEmpty')}</option>
                    {CONTACT_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {tl(`language.${l}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </form.Field>
            <form.Field name="note">
              {(field) => (
                <div className="mb-[18px]">
                  <FieldLabel icon={<FileText className="size-3.5 text-amber-400" />}>{t('note')}</FieldLabel>
                  <textarea
                    rows={2}
                    className={cn(inputClass, 'min-h-[60px] resize-y text-[13px]')}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t('notePlaceholder')}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            {serverError && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/15 px-3.5 py-2.5 text-[12.5px] text-red-400">
                {serverError}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-2.5">
              <div>
                {contact && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-[9px] text-[12.5px] font-semibold text-red-400 hover:bg-red-500/25"
                  >
                    <Icon name="trash" className="size-3.5" /> {t('delete')}
                  </button>
                )}
              </div>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-lg border border-white/15 bg-white/[0.08] px-[18px] py-[9px] text-[13px] font-medium text-slate-300 hover:bg-white/15"
                >
                  {t('cancel')}
                </button>
                <form.Subscribe selector={(s) => s.isSubmitting}>
                  {(submitting) => (
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/45 bg-[linear-gradient(135deg,#6366f1_0%,#4f46e5_100%)] px-6 py-[9px] text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(99,102,241,0.35)] transition-all hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(99,102,241,0.5)] disabled:opacity-60"
                    >
                      <Icon name="tick-circle" className="size-3.5" /> {t('save')}
                    </button>
                  )}
                </form.Subscribe>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {contact && (
        <DangerConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('delete')}
          message={t('deleteConfirm', { phone: contact.phone })}
          okText={t('deleteOk')}
          cancelText={t('deleteCancel')}
          busy={deleting}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}
