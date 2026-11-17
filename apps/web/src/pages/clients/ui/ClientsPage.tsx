import type { Contact, ContactLanguage, TopActiveClient } from '@cc/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send } from 'lucide-react';
import { type ReactNode, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LanguageBadge,
  contactKeys,
  contactsQuery,
  telegramUrl,
  topActiveQuery,
  useContactAccess,
  useContactsLive,
} from '@/entities/contact';
import { DeleteContactButton } from '@/features/contacts/delete-contact';
import { ContactDialog } from '@/features/contacts/edit-contact';
import { cn } from '@/shared/lib/cn';
import { tashkentDateTime } from '@/shared/lib/tashkent-time';
import { Icon } from '@/shared/ui/icon';

type LangFilter = '' | ContactLanguage | 'none';
const LANG_FILTERS: LangFilter[] = ['', 'uz', 'ru', 'en', 'other', 'none'];

const panel = 'min-w-0 rounded-2xl border border-white/[0.08] bg-muted p-[22px]';
const actionBtn =
  'inline-flex size-[30px] items-center justify-center rounded-[7px] border border-white/10 bg-white/5 text-slate-300 transition-all duration-150 hover:-translate-y-px hover:bg-white/[0.12] hover:text-white';

type DialogState = { contact: Contact | null; presetPhone?: string } | null;

/** "Mijozlar" (legacy /clients): phonebook, today's most active callers, search and language filter. */
export function ClientsPage() {
  const { t } = useTranslation('clients');
  const queryClient = useQueryClient();
  const { canEdit } = useContactAccess();
  useContactsLive();
  const contacts = useQuery(contactsQuery);
  const top = useQuery(topActiveQuery({ date: 'today', limit: 8 }));
  const [search, setSearch] = useState('');
  const [lang, setLang] = useState<LangFilter>('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const query = useDeferredValue(search.trim().toLowerCase());

  const all = useMemo(() => contacts.data?.items ?? [], [contacts.data]);
  const filtered = useMemo(
    () =>
      all.filter((c) => {
        if (lang === 'none' ? c.language !== null : lang && c.language !== lang) return false;
        if (!query) return true;
        const digits = query.replace(/\D/g, '');
        return (
          [c.name, c.organization, c.note, c.language ?? '', c.telegram ?? ''].some((v) =>
            v.toLowerCase().includes(query),
          ) ||
          (digits.length > 0 && (c.phone.includes(digits) || `998${c.phone}`.includes(digits)))
        );
      }),
    [all, lang, query],
  );

  return (
    <div className="p-1">
      <div className={cn(panel, 'mb-5')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="inline-flex items-center gap-2 text-base font-semibold">
              <Icon name="user" className="size-5" />
              {t('title')}
            </h3>
            <p className="mt-1 text-xs text-slate-400">{t('subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/5 px-3 py-1.5 text-xs text-slate-400">
              <span className="size-[7px] rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
              {t('total', { n: contacts.data?.total ?? 0 })}
            </div>
            <button
              type="button"
              title={t('refreshTitle')}
              onClick={() => void queryClient.invalidateQueries({ queryKey: contactKeys.all })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-[7px] text-xs font-medium text-slate-300 transition-all hover:shadow-[0_2px_8px_rgba(99,102,241,0.4)]"
            >
              <Icon name="refresh" className="size-3.5" />
              {t('refresh')}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setDialog({ contact: null })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/45 bg-[linear-gradient(135deg,#6366f1_0%,#4f46e5_100%)] px-[18px] py-[7px] text-[12.5px] font-semibold text-white shadow-[0_4px_12px_rgba(99,102,241,0.35)]"
              >
                <Plus className="size-[15px]" strokeWidth={2.5} />
                {t('add')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={cn(panel, 'mb-5')}>
        <div className="mb-4 border-b border-white/[0.08] pb-3">
          <h4 className="flex items-center gap-2 text-[14.5px] font-bold text-white">
            <Icon name="flash" className="size-4 text-amber-500" />
            {t('topTitle')}
          </h4>
          <p className="mt-[3px] text-[11.5px] text-slate-500">{t('topSubtitle')}</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
          {top.data && top.data.items.length > 0 ? (
            top.data.items.map((c, i) => (
              <TopCallerCard
                key={c.phone}
                client={c}
                rank={i + 1}
                canEdit={canEdit}
                onEdit={() => setDialog(c.contact ? { contact: c.contact } : { contact: null, presetPhone: c.phone })}
              />
            ))
          ) : (
            <div className="col-span-full rounded-[10px] border border-dashed border-white/[0.08] bg-black/20 p-7 text-center text-[13px] text-slate-400">
              {top.isLoading ? t('loading') : top.isError ? t('topUnavailable') : t('topEmpty')}
            </div>
          )}
        </div>
      </div>

      <div className={panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3.5">
          <div className="relative min-w-[260px] flex-1">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full rounded-lg border border-white/[0.12] bg-sidebar/70 py-2.5 pr-[38px] pl-3.5 text-[13px] text-white outline-none transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 p-1 text-slate-400"
                aria-label="clear"
              >
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {LANG_FILTERS.map((l) => (
              <button
                key={l || 'all'}
                type="button"
                onClick={() => setLang(l)}
                className={cn(
                  'cursor-pointer rounded-[20px] border border-white/[0.12] bg-white/5 px-[13px] py-[5px] text-xs font-medium whitespace-nowrap text-slate-500 transition-all select-none hover:border-white/20 hover:bg-white/10 hover:text-white',
                  lang === l &&
                    'border-primary/55 bg-[linear-gradient(135deg,rgba(99,102,241,0.3),rgba(79,70,229,0.2))] font-semibold text-indigo-300 shadow-[0_2px_8px_rgba(99,102,241,0.2)]',
                )}
              >
                {t(`lang.${l || 'all'}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[600px] w-full overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full border-collapse text-center text-[13px]">
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-white/[0.08] [&>th]:bg-slate-800/85 [&>th]:px-3.5 [&>th]:py-3 [&>th]:text-[11px] [&>th]:font-bold [&>th]:tracking-[0.6px] [&>th]:whitespace-nowrap [&>th]:text-slate-400 [&>th]:uppercase">
                <th className="w-[45px]">№</th>
                <th className="text-left">{t('col.client')}</th>
                <th className="text-left">{t('col.org')}</th>
                <th>{t('col.lang')}</th>
                <th>{t('col.updated')}</th>
                <th className="text-left">{t('col.note')}</th>
                <th className="w-[140px] text-right">{t('col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.isLoading ? (
                <EmptyRow>{t('loading')}</EmptyRow>
              ) : filtered.length === 0 ? (
                <EmptyRow>{query || lang ? t('emptySearch') : t('empty')}</EmptyRow>
              ) : (
                filtered.map((c, i) => (
                  <tr
                    key={c.phone}
                    className="border-l-[3px] border-transparent transition-[background,filter] duration-150 hover:bg-white/[0.04] hover:brightness-115 [&>td]:border-b [&>td]:border-white/5 [&>td]:px-3.5 [&>td]:py-[11px] [&>td]:whitespace-nowrap"
                  >
                    <td className="text-xs text-slate-400">{i + 1}</td>
                    <td className="text-left">
                      <div className="flex items-center gap-2">
                        <div className="flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 text-indigo-400">
                          <Icon name="user" className="size-[15px]" />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-white">{c.name || c.phone}</div>
                          {c.name && <div className="font-mono text-[11.5px] text-slate-400">{c.phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td className={cn('text-left text-[12.5px]', c.organization ? 'text-slate-200' : 'text-slate-500')}>
                      {c.organization || '—'}
                    </td>
                    <td>
                      <LanguageBadge language={c.language} />
                    </td>
                    <td className="text-xs text-slate-400">{tashkentDateTime(c.updatedAt).slice(0, 16)}</td>
                    <td className="max-w-[220px] truncate text-left text-xs text-slate-400" title={c.note}>
                      {c.note || '—'}
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <TelegramButton telegram={c.telegram} phone={c.phone} />
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              title={t('edit')}
                              onClick={() => setDialog({ contact: c })}
                              className={cn(
                                actionBtn,
                                'hover:border-primary/40 hover:bg-primary/20 hover:text-indigo-400',
                              )}
                            >
                              <Icon name="edit" className="size-3.5" />
                            </button>
                            <DeleteContactButton
                              phone={c.phone}
                              className={cn(
                                actionBtn,
                                'hover:border-red-500/40 hover:bg-red-500/20 hover:text-red-400',
                              )}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3.5 flex items-center justify-between px-1 text-xs text-slate-400">
          <span>{t('shown', { n: filtered.length, total: all.length })}</span>
        </div>
      </div>

      {dialog && (
        <ContactDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          contact={dialog.contact}
          presetPhone={dialog.presetPhone}
        />
      )}
    </div>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={7} className="p-10 text-center text-slate-500">
        <div className="flex flex-col items-center gap-2">
          <Icon name="search-normal" className="size-7 opacity-40" />
          {children}
        </div>
      </td>
    </tr>
  );
}

function TelegramButton({ telegram, phone }: { telegram: string | null; phone: string }) {
  const { t } = useTranslation('clients');
  const url = telegram ? telegramUrl(telegram, phone) : null;
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={t('telegram', { id: telegram })}
      className={cn(actionBtn, 'border-sky-400/30 bg-sky-400/[0.12] text-sky-400')}
    >
      <Send className="size-3.5" />
    </a>
  );
}

const RANK: Record<number, string> = {
  1: 'bg-[linear-gradient(135deg,#f59e0b,#d97706)] text-white shadow-[0_0_12px_rgba(245,158,11,0.45)]',
  2: 'bg-[linear-gradient(135deg,#94a3b8,#64748b)] text-white shadow-[0_0_10px_rgba(148,163,184,0.35)]',
  3: 'bg-[linear-gradient(135deg,#b45309,#78350f)] text-amber-100 shadow-[0_0_10px_rgba(180,83,9,0.35)]',
};

function TopCallerCard({
  client,
  rank,
  canEdit,
  onEdit,
}: {
  client: TopActiveClient;
  rank: number;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('clients');
  const c = client.contact;
  const saved = Boolean(c && (c.name || c.organization));
  const displayName = c?.name || c?.organization || client.phone;
  const subInfo = c?.name && c.organization ? c.organization : saved ? client.phone : t('unsaved');
  const pct = client.totalCalls ? Math.round((client.answeredCalls / client.totalCalls) * 100) : 0;
  const pctColor = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="relative flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[linear-gradient(145deg,rgba(30,41,59,0.7),rgba(15,23,42,0.8))] px-4 py-3.5 backdrop-blur-[8px] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.35),0_0_16px_rgba(99,102,241,0.15)]">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
              RANK[rank] ?? 'border border-white/[0.12] bg-white/[0.08] text-slate-400',
            )}
          >
            #{rank}
          </div>
          <div className="min-w-0">
            <h4 title={client.phone} className="truncate text-sm font-bold text-white">
              {displayName}
            </h4>
            <p className={cn('mt-0.5 truncate text-[11.5px]', saved ? 'text-slate-400' : 'text-amber-400')}>
              {subInfo}
            </p>
          </div>
        </div>
        <LanguageBadge language={c?.language ?? null} />
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.04] bg-black/25 px-2.5 py-2">
        <div className="flex flex-col">
          <span className="text-[10.5px] font-semibold tracking-[0.3px] text-slate-400 uppercase">{t('calls')}</span>
          <span className="mt-0.5 text-[13px] font-bold text-blue-400">{t('count', { n: client.totalCalls })}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10.5px] font-semibold tracking-[0.3px] text-slate-400 uppercase">{t('success')}</span>
          <span className={cn('mt-0.5 text-[13px] font-bold', pctColor)}>
            {pct}% ({client.answeredCalls})
          </span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-white/[0.06] pt-2">
        <div className="inline-flex items-center gap-1 text-[11px] text-slate-400">
          <Icon name="clock" className="size-3" />
          {tashkentDateTime(client.lastCallAt).slice(0, 16)}
        </div>
        <div className="flex gap-1.5">
          {saved && <TelegramButton telegram={c?.telegram ?? null} phone={client.phone} />}
          {canEdit &&
            (saved ? (
              <button type="button" title={t('edit')} onClick={onEdit} className={actionBtn}>
                <Icon name="edit" className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/20 px-2.5 py-1 text-[11px] font-semibold text-indigo-300"
              >
                <Plus className="size-3" strokeWidth={2.5} />
                {t('save')}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
