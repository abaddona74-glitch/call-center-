import { type LockoutEntry, type LockoutSettings, LockoutSettingsSchema } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useHasRole } from '@/entities/session';
import { formatDateTime } from '@/shared/lib/format-datetime';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import { FieldHint, FieldLabel, Pill, SettingsButton, SettingsCard, SettingsCardHeader } from '@/shared/ui/settings-panel';
import { adminKeys, lockoutsQuery, saveSecuritySettings, securitySettingsQuery, unlock, unlockAll } from '../api/admin.queries';

const col = dataTableColumns<LockoutEntry>();

function Slider({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>
        {label}
        <span className="rounded-md bg-[rgba(59,130,246,0.2)] px-2 py-0.5 text-[11px] font-bold text-[#60a5fa]">
          {value}
          {suffix}
        </span>
      </FieldLabel>
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] font-semibold text-[#64748b]">{min}</span>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-[#3b82f6] disabled:cursor-not-allowed"
        />
        <span className="text-[11px] font-semibold text-[#64748b]">{max}</span>
      </div>
      <FieldHint>{hint}</FieldHint>
    </div>
  );
}

export function SecuritySettingsPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const isSuperuser = useHasRole('superuser');
  const { data: settings } = useQuery(securitySettingsQuery);
  const { data: lockouts, isLoading } = useQuery(lockoutsQuery);
  const [draft, setDraft] = useState<LockoutSettings | null>(null);
  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: saveSecuritySettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(adminKeys.security, saved);
      toast.success(t('common.saved'));
    },
    onError: () => toast.error(t('common.failed')),
  });
  const refreshLockouts = () => queryClient.invalidateQueries({ queryKey: adminKeys.lockouts });
  const unlockOne = useMutation({ mutationFn: unlock, onSuccess: () => void refreshLockouts() });
  const unlockEvery = useMutation({
    mutationFn: unlockAll,
    onSuccess: (count) => {
      toast.success(t('security.unlocked', { count }));
      void refreshLockouts();
    },
  });

  const columns = useMemo<DataTableColumn<LockoutEntry>[]>(
    () => [
      col.accessor('kind', {
        header: () => t('security.colKind'),
        cell: ({ getValue }) => (
          <Pill tone={getValue() === 'ip' ? 'red' : getValue() === 'user' ? 'amber' : 'purple'}>{t(`security.kind.${getValue()}`)}</Pill>
        ),
      }),
      col.accessor('username', {
        header: () => t('security.colUser'),
        cell: ({ getValue }) => <span className="font-semibold text-[#e2e8f0]">{getValue() ?? '—'}</span>,
      }),
      col.accessor('ip', {
        header: () => t('security.colIp'),
        cell: ({ getValue }) => <span className="font-mono text-[11px] text-[#38bdf8]">{getValue() ?? '—'}</span>,
      }),
      col.accessor('lockedUntil', { header: () => t('security.colUntil'), cell: ({ getValue }) => formatDateTime(getValue()) }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <SettingsButton size="sm" tone="success" disabled={unlockOne.isPending} onClick={() => unlockOne.mutate(row.original.id)}>
            <Icon name="unlock" className="size-3" />
            {t('security.unlock')}
          </SettingsButton>
        ),
      }),
    ],
    [t, unlockOne],
  );

  const valid = draft ? LockoutSettingsSchema.safeParse(draft).success : false;
  const dirty = draft && settings && JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard>
        <SettingsCardHeader icon={<Icon name="shield-security" className="size-5" />} title={t('security.title')} description={t('security.description')} />
        {draft && (
          <div className="grid gap-4 md:grid-cols-3">
            <Slider
              id="sec-max"
              label={t('security.maxAttempts')}
              hint={t('security.maxAttemptsHint')}
              value={draft.maxAttempts}
              min={3}
              max={10}
              disabled={!isSuperuser}
              onChange={(v) => setDraft({ ...draft, maxAttempts: v })}
            />
            <Slider
              id="sec-minutes"
              label={t('security.lockoutMinutes')}
              hint={t('security.lockoutHint')}
              value={draft.lockoutMinutes}
              min={1}
              max={1440}
              step={1}
              disabled={!isSuperuser}
              onChange={(v) => setDraft({ ...draft, lockoutMinutes: v })}
            />
            <Slider
              id="sec-ip"
              label={t('security.ipMaxAttempts')}
              hint={t('security.ipHint')}
              value={draft.ipMaxAttempts}
              min={5}
              max={200}
              disabled={!isSuperuser}
              onChange={(v) => setDraft({ ...draft, ipMaxAttempts: v })}
            />
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <FieldHint>{isSuperuser ? '' : t('security.readonly')}</FieldHint>
          {isSuperuser && (
            <SettingsButton disabled={!dirty || !valid || save.isPending} onClick={() => draft && save.mutate(draft)}>
              {t('common.save')}
            </SettingsButton>
          )}
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeader
          icon={<Icon name="unlock" className="size-5" />}
          title={t('security.lockoutsTitle')}
          description={t('security.lockoutsText')}
          actions={
            <SettingsButton tone="danger" disabled={!lockouts?.length || unlockEvery.isPending} onClick={() => unlockEvery.mutate()}>
              {t('security.unlockAll')}
            </SettingsButton>
          }
        />
        <DataTable columns={columns} data={lockouts} loading={isLoading} getRowId={(l) => String(l.id)} empty={t('security.empty')} />
      </SettingsCard>
    </div>
  );
}
