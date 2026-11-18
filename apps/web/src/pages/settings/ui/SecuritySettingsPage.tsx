import { type LockoutEntry, type LockoutSettings, LockoutSettingsSchema } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { usePermission } from '@/entities/session';
import { Icon } from '@/shared/ui/icon';
import { IconShieldTick } from '@/shared/ui/inline-icons';
import {
  FieldHint,
  FieldLabel,
  SettingsButton,
  SettingsCard,
  SettingsCardHeader,
  SettingsSelect,
} from '@/shared/ui/settings-panel';
import {
  adminKeys,
  lockoutsQuery,
  saveSecuritySettings,
  securitySettingsQuery,
  unlock,
  unlockAll,
} from '../api/admin.queries';

/** Legacy duration choices (minutes). */
const DURATIONS = [15, 30, 60, 120, 360, 720, 1440];

function RangeField({
  id,
  label,
  badge,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  badge: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>
        {label}
        <span className="rounded-md bg-[rgba(59,130,246,0.2)] px-2 py-0.5 text-[11px] font-bold text-[#60a5fa]">
          {badge}
        </span>
      </FieldLabel>
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] font-semibold text-[#64748b]">{min}</span>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
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

/** Legacy "Xavfsizlik & Rate Limit" tab: brute-force settings + currently locked list. */
export function SecuritySettingsPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const isSuperuser = usePermission('security.manage');
  const { data: settings } = useQuery(securitySettingsQuery);
  const { data: lockouts, isLoading, refetch, isFetching } = useQuery(lockoutsQuery);
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

  const durations =
    draft && !DURATIONS.includes(draft.lockoutMinutes)
      ? [...DURATIONS, draft.lockoutMinutes].sort((a, b) => a - b)
      : DURATIONS;
  const durationLabel = (m: number) =>
    m < 60
      ? t('security.minutes', { count: m })
      : m === 1440
        ? t('security.day')
        : t('security.hours', { count: m / 60, minutes: m });
  const valid = draft ? LockoutSettingsSchema.safeParse(draft).success : false;
  const dirty = draft && settings && JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard>
        <SettingsCardHeader title={t('security.title')} description={t('security.description')} />
        {draft && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <RangeField
                id="sec-max"
                label={t('security.maxAttempts')}
                badge={t('security.attemptsBadge', { count: draft.maxAttempts })}
                hint={t('security.maxAttemptsHint')}
                value={draft.maxAttempts}
                min={3}
                max={10}
                disabled={!isSuperuser}
                onChange={(v) => setDraft({ ...draft, maxAttempts: v })}
              />
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="sec-duration">{t('security.lockoutMinutes')}</FieldLabel>
                <SettingsSelect
                  id="sec-duration"
                  value={draft.lockoutMinutes}
                  disabled={!isSuperuser}
                  onChange={(e) => setDraft({ ...draft, lockoutMinutes: Number(e.target.value) })}
                >
                  {durations.map((m) => (
                    <option key={m} value={m}>
                      {durationLabel(m)}
                    </option>
                  ))}
                </SettingsSelect>
                <FieldHint>{t('security.lockoutHint')}</FieldHint>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <RangeField
                id="sec-ip"
                label={t('security.ipMaxAttempts')}
                badge={t('security.attemptsBadge', { count: draft.ipMaxAttempts })}
                hint={t('security.ipHint')}
                value={draft.ipMaxAttempts}
                min={5}
                max={200}
                disabled={!isSuperuser}
                onChange={(v) => setDraft({ ...draft, ipMaxAttempts: v })}
              />
            </div>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <FieldHint>{isSuperuser ? '' : t('security.readonly')}</FieldHint>
          {isSuperuser && (
            <SettingsButton disabled={!dirty || !valid || save.isPending} onClick={() => draft && save.mutate(draft)}>
              <IconShieldTick size={16} />
              {t('common.save')}
            </SettingsButton>
          )}
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeader
          title={t('security.lockoutsTitle')}
          description={t('security.lockoutsText')}
          actions={
            <>
              <SettingsButton tone="ghost" disabled={isFetching} onClick={() => void refetch()}>
                <Icon name="refresh" className="size-3.5" />
                {t('common.refresh')}
              </SettingsButton>
              {Boolean(lockouts?.length) && (
                <SettingsButton tone="danger" disabled={unlockEvery.isPending} onClick={() => unlockEvery.mutate()}>
                  <Icon name="unlock" className="size-3.5" />
                  {t('security.unlockAll')}
                </SettingsButton>
              )}
            </>
          }
        />
        {lockouts && lockouts.length > 0 ? (
          <div className="flex flex-col gap-2">
            {lockouts.map((l) => (
              <LockoutRow key={l.id} entry={l} pending={unlockOne.isPending} onUnlock={() => unlockOne.mutate(l.id)} />
            ))}
          </div>
        ) : (
          <div className="py-[18px] text-center text-[12.5px] text-[#94a3b8]">
            {isLoading ? '…' : t('security.empty')}
          </div>
        )}
      </SettingsCard>
    </div>
  );
}

function LockoutRow({ entry, pending, onUnlock }: { entry: LockoutEntry; pending: boolean; onUnlock: () => void }) {
  const { t } = useTranslation('settings');
  const minutes = Math.max(0, Math.ceil((new Date(entry.lockedUntil).getTime() - Date.now()) / 60_000));
  const title =
    entry.kind === 'ip' ? entry.ip : entry.kind === 'user' ? entry.username : `${entry.username} @ ${entry.ip}`;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded bg-[rgba(239,68,68,0.2)] px-[7px] py-0.5 text-[11px] font-semibold text-[#f87171]">
          {t(`security.kind.${entry.kind}`)}
        </span>
        <span className="text-[13px] font-semibold text-[#f1f5f9]">{title}</span>
        <span className="text-xs text-[#94a3b8]">({t('security.remaining', { minutes })})</span>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={onUnlock}
        className="cursor-pointer rounded-md border border-[rgba(56,189,248,0.3)] bg-[rgba(56,189,248,0.15)] px-2.5 py-1 text-[11px] text-[#38bdf8] hover:bg-[rgba(56,189,248,0.25)] disabled:opacity-50"
      >
        {t('security.unlock')}
      </button>
    </div>
  );
}
