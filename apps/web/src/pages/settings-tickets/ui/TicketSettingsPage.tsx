import {
  TICKET_ORGANIZATION_IMPORT_MAX_MB,
  type TicketCategory,
  type TicketCity,
  type TicketOrganizationImportResult,
  type TicketRegion,
} from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  KdsAction,
  KdsInput,
  dateTime,
  importTicketOrganizations,
  refName,
  ticketDirectories,
  ticketDirectoriesQuery,
  ticketExecutivesQuery,
  ticketKeys,
  ticketOrganizationsSummaryQuery,
} from '@/entities/ticket';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

/** Superuser: ticket directories and executive ↔ region links (all changes audited on the server). */
export function TicketSettingsPage() {
  const { t, i18n } = useTranslation('ticketSettings');
  const dirs = useQuery(ticketDirectoriesQuery);
  const [regionId, setRegionId] = useState<number | null>(null);
  const regions = dirs.data?.regions ?? [];
  const region = regions.find((r) => r.id === regionId) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <div>
        <h1 className="m-0 inline-flex items-center gap-2 text-lg font-bold text-ink">
          <Icon name="setting-4" className="size-5" />
          {t('title')}
        </h1>
        <p className="m-0 mt-1 text-xs text-mute">{t('subtitle')}</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={t('regions')} extra={t('regionsCount', { n: regions.length })}>
          <RegionForm />
          <ul className="mt-3 flex max-h-[520px] flex-col gap-1.5 overflow-y-auto pr-1">
            {regions.map((r) => (
              <DirectoryRow
                key={r.id}
                row={r}
                selected={r.id === regionId}
                onSelect={() => setRegionId(r.id)}
                extra={<span className="font-mono text-[11px] text-dim">{r.code}</span>}
                count={r.cities.length}
                kind="region"
              />
            ))}
          </ul>
        </Card>
        <Card title={region ? t('citiesOf', { region: refName(region, i18n.language) }) : t('cities')}>
          {region ? (
            <>
              <CityForm regionId={region.id} />
              <ul className="mt-3 flex max-h-[520px] flex-col gap-1.5 overflow-y-auto pr-1">
                {region.cities.length === 0 && <li className="py-3 text-center text-xs text-dim">{t('empty')}</li>}
                {region.cities.map((c) => (
                  <DirectoryRow key={c.id} row={c} kind="city" />
                ))}
              </ul>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-mute">{t('pickRegion')}</p>
          )}
        </Card>
        <Card title={t('categories')}>
          <CategoryForm />
          <ul className="mt-3 flex flex-col gap-1.5">
            {(dirs.data?.categories ?? []).map((c) => (
              <DirectoryRow key={c.id} row={c} kind="category" />
            ))}
          </ul>
        </Card>
        <Card title={t('executives')}>
          <p className="mb-3 text-xs text-mute">{t('executivesHint')}</p>
          <ExecutiveRegions regions={regions} />
        </Card>
        <OrganizationsCard />
      </div>
    </div>
  );
}

/** The organization registry the ticket form searches: import of the registry's .xlsx export. */
function OrganizationsCard() {
  const { t } = useTranslation('ticketSettings');
  const queryClient = useQueryClient();
  const summary = useQuery(ticketOrganizationsSummaryQuery);
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<TicketOrganizationImportResult | null>(null);
  const upload = useMutation({
    mutationFn: importTicketOrganizations,
    onSuccess: async (res) => {
      setResult(res);
      toast.success(t('organizationsResult', res));
      await queryClient.invalidateQueries({ queryKey: ['tickets', 'organizations'] });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
    onSettled: () => {
      if (fileRef.current) fileRef.current.value = '';
    },
  });
  const s = summary.data;

  return (
    <Card
      title={t('organizations')}
      extra={s ? t('organizationsCount', { n: s.active.toLocaleString('ru-RU') }) : undefined}
    >
      <p className="mb-3 text-xs text-mute">{t('organizationsHint')}</p>
      <p className="mb-3 text-[13px] text-ink-2">
        {s?.importedAt ? t('organizationsImportedAt', { date: dateTime(s.importedAt) }) : t('organizationsEmpty')}
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > TICKET_ORGANIZATION_IMPORT_MAX_MB * 1024 * 1024) {
            toast.error(t('organizationsTooBig', { mb: TICKET_ORGANIZATION_IMPORT_MAX_MB }));
            e.target.value = '';
            return;
          }
          upload.mutate(file);
        }}
      />
      <KdsAction variant="edit" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
        <Icon name="import" className="size-4" />
        {upload.isPending ? t('organizationsImporting') : t('organizationsPick')}
      </KdsAction>
      {result && (
        <p className="mt-3 rounded-[10px] border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.08)] px-3 py-2 text-xs text-[#6ee7b7] light:text-positive">
          {t('organizationsResult', result)}
        </p>
      )}
    </Card>
  );
}

function Card({ title, extra, children }: { title: string; extra?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-tint/[0.08] bg-muted p-[22px]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold text-ink">{title}</h2>
        {extra && <span className="text-xs text-mute">{extra}</span>}
      </div>
      {children}
    </section>
  );
}

function useDirMutation<A>(fn: (a: A) => Promise<unknown>, onDone?: () => void) {
  const { t } = useTranslation('ticketSettings');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      onDone?.();
      await queryClient.invalidateQueries({ queryKey: ticketKeys.directories });
      await queryClient.invalidateQueries({ queryKey: ticketKeys.executives });
    },
    onError: (err) => toast.error(t('error', { message: err.message })),
  });
}

function NameInputs({
  uz,
  ru,
  setUz,
  setRu,
}: {
  uz: string;
  ru: string;
  setUz: (v: string) => void;
  setRu: (v: string) => void;
}) {
  const { t } = useTranslation('ticketSettings');
  return (
    <>
      <KdsInput
        value={uz}
        onChange={(e) => setUz(e.target.value)}
        placeholder={t('nameUz')}
        aria-label={t('nameUz')}
        required
        minLength={2}
        maxLength={120}
      />
      <KdsInput
        value={ru}
        onChange={(e) => setRu(e.target.value)}
        placeholder={t('nameRu')}
        aria-label={t('nameRu')}
        required
        minLength={2}
        maxLength={120}
      />
    </>
  );
}

function RegionForm() {
  const { t } = useTranslation('ticketSettings');
  const [code, setCode] = useState('');
  const [uz, setUz] = useState('');
  const [ru, setRu] = useState('');
  const save = useDirMutation(
    () => ticketDirectories.createRegion({ code: code.trim(), nameUz: uz.trim(), nameRu: ru.trim() }),
    () => {
      setCode('');
      setUz('');
      setRu('');
    },
  );
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
      onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
    >
      <KdsInput
        value={code}
        onChange={(e) => setCode(e.target.value.toLowerCase())}
        placeholder={t('code')}
        aria-label={t('code')}
        required
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        maxLength={60}
      />
      <NameInputs uz={uz} ru={ru} setUz={setUz} setRu={setRu} />
      <KdsAction type="submit" variant="complete" disabled={save.isPending} className="justify-center px-3.5 py-2">
        {t('add')}
      </KdsAction>
    </form>
  );
}

function CityForm({ regionId }: { regionId: number }) {
  const { t } = useTranslation('ticketSettings');
  const [uz, setUz] = useState('');
  const [ru, setRu] = useState('');
  const save = useDirMutation(
    () => ticketDirectories.createCity(regionId, { nameUz: uz.trim(), nameRu: ru.trim() }),
    () => {
      setUz('');
      setRu('');
    },
  );
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
    >
      <NameInputs uz={uz} ru={ru} setUz={setUz} setRu={setRu} />
      <KdsAction type="submit" variant="complete" disabled={save.isPending} className="justify-center px-3.5 py-2">
        {t('add')}
      </KdsAction>
    </form>
  );
}

function CategoryForm() {
  const { t } = useTranslation('ticketSettings');
  const [uz, setUz] = useState('');
  const [ru, setRu] = useState('');
  const save = useDirMutation(
    () => ticketDirectories.createCategory({ nameUz: uz.trim(), nameRu: ru.trim() }),
    () => {
      setUz('');
      setRu('');
    },
  );
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
    >
      <NameInputs uz={uz} ru={ru} setUz={setUz} setRu={setRu} />
      <KdsAction type="submit" variant="complete" disabled={save.isPending} className="justify-center px-3.5 py-2">
        {t('add')}
      </KdsAction>
    </form>
  );
}

type Row = TicketRegion | TicketCity | TicketCategory;

/** One directory row: rename inline, activate/deactivate, delete (the server refuses rows in use). */
function DirectoryRow({
  row,
  kind,
  selected,
  onSelect,
  extra,
  count,
}: {
  row: Row;
  kind: 'region' | 'city' | 'category';
  selected?: boolean;
  onSelect?: () => void;
  extra?: ReactNode;
  count?: number;
}) {
  const { t, i18n } = useTranslation('ticketSettings');
  const [editing, setEditing] = useState(false);
  const [uz, setUz] = useState(row.nameUz);
  const [ru, setRu] = useState(row.nameRu);
  const update = useDirMutation(
    (patch: { nameUz?: string; nameRu?: string; isActive?: boolean }) => {
      if (kind === 'region') return ticketDirectories.updateRegion(row.id, patch);
      if (kind === 'city') return ticketDirectories.updateCity(row.id, patch);
      return ticketDirectories.updateCategory(row.id, patch);
    },
    () => setEditing(false),
  );
  const remove = useDirMutation(() => {
    if (kind === 'region') return ticketDirectories.deleteRegion(row.id);
    if (kind === 'city') return ticketDirectories.deleteCity(row.id);
    return ticketDirectories.deleteCategory(row.id);
  });

  if (editing) {
    return (
      <li className="rounded-xl border border-[rgba(56,189,248,0.35)] bg-glass/60 p-2">
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]"
          onSubmit={(e: FormEvent) => (e.preventDefault(), update.mutate({ nameUz: uz.trim(), nameRu: ru.trim() }))}
        >
          <NameInputs uz={uz} ru={ru} setUz={setUz} setRu={setRu} />
          <KdsAction
            type="submit"
            variant="primary"
            className="justify-center px-3 py-2 text-xs"
            disabled={update.isPending}
          >
            {t('save')}
          </KdsAction>
          <KdsAction variant="delete" className="justify-center px-3 py-2 text-xs" onClick={() => setEditing(false)}>
            ×
          </KdsAction>
        </form>
      </li>
    );
  }
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-xl border border-tint/6 bg-glass/50 px-3 py-2 text-[13px]',
        selected && 'border-[rgba(56,189,248,0.55)] bg-[rgba(56,189,248,0.1)]',
        !row.isActive && 'opacity-55',
      )}
    >
      <button
        type="button"
        disabled={!onSelect}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        <span className="truncate font-semibold text-ink">{refName(row, i18n.language)}</span>
        <span className="truncate text-xs text-dim">{i18n.language.startsWith('ru') ? row.nameUz : row.nameRu}</span>
        {extra}
        {count !== undefined && count > 0 && (
          <span className="rounded-md bg-tint/8 px-1.5 text-[11px] text-ink-2">{count}</span>
        )}
      </button>
      {!row.isActive && <span className="text-[11px] font-semibold text-caution">{t('inactive')}</span>}
      <button
        type="button"
        title={t('rename')}
        onClick={() => setEditing(true)}
        className="rounded p-1 text-mute hover:text-info"
      >
        <Icon name="edit" className="size-3.5" />
      </button>
      <button
        type="button"
        title={row.isActive ? t('deactivate') : t('activate')}
        onClick={() => update.mutate({ isActive: !row.isActive })}
        className={cn(
          'rounded px-1.5 py-0.5 text-[11px] font-semibold',
          row.isActive ? 'text-mute hover:text-caution' : 'text-positive hover:text-ink',
        )}
      >
        {row.isActive ? t('deactivate') : t('activate')}
      </button>
      <button
        type="button"
        title={t('delete')}
        onClick={() => {
          if (window.confirm(t('deleteConfirm', { name: refName(row, i18n.language) }))) remove.mutate(undefined);
        }}
        className="rounded p-1 text-dim hover:text-danger"
      >
        <Icon name="trash" className="size-3.5" />
      </button>
    </li>
  );
}

function ExecutiveRegions({ regions }: { regions: Array<TicketRegion & { cities: TicketCity[] }> }) {
  const { t, i18n } = useTranslation('ticketSettings');
  const execs = useQuery(ticketExecutivesQuery);
  const save = useDirMutation(
    (v: { userId: number; regionIds: number[] }) => ticketDirectories.setExecutiveRegions(v.userId, v.regionIds),
    () => toast.success(t('saved')),
  );
  if (execs.data && execs.data.length === 0)
    return <p className="py-4 text-center text-sm text-mute">{t('noExecutives')}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {(execs.data ?? []).map((e) => (
        <li key={e.userId} className="rounded-xl border border-tint/6 bg-glass/50 p-3">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Icon name="user" className="size-4 text-violet" />
            {e.name ?? e.username}
            {e.extension && <span className="text-xs text-dim">({e.extension})</span>}
            <span className="ml-auto text-xs text-mute">{t('regionsCount', { n: e.regionIds.length })}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {regions
              .filter((r) => r.isActive || e.regionIds.includes(r.id))
              .map((r) => {
                const on = e.regionIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={on}
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutate({
                        userId: e.userId,
                        regionIds: on ? e.regionIds.filter((x) => x !== r.id) : [...e.regionIds, r.id],
                      })
                    }
                    className={cn(
                      'rounded-[20px] border px-3 py-1 text-[11.5px] font-semibold transition-all duration-150',
                      on
                        ? 'border-[rgba(139,92,246,0.55)] bg-[rgba(139,92,246,0.22)] text-[#e9d5ff] light:text-violet'
                        : 'border-tint/10 bg-tint/5 text-mute hover:border-[rgba(139,92,246,0.4)] hover:text-ink',
                    )}
                  >
                    {refName(r, i18n.language)}
                  </button>
                );
              })}
          </div>
        </li>
      ))}
    </ul>
  );
}
