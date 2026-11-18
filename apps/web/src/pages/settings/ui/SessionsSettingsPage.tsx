import type { SessionInfo } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatDateTime } from '@/shared/lib/format-datetime';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import { Pill, SettingsButton, SettingsCard, SettingsCardHeader } from '@/shared/ui/settings-panel';
import { adminKeys, adminSessionsQuery, revokeSession } from '../api/admin.queries';

const col = dataTableColumns<SessionInfo>();

export function SessionsSettingsPage() {
  const { t } = useTranslation('settings');
  const { t: tu } = useTranslation('user');
  const queryClient = useQueryClient();
  const { data: sessions, isLoading, refetch, isFetching } = useQuery(adminSessionsQuery);

  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      toast.success(t('sessions.revoked'));
      void queryClient.invalidateQueries({ queryKey: adminKeys.sessions });
    },
    onError: () => toast.error(t('common.failed')),
  });

  const columns = useMemo<DataTableColumn<SessionInfo>[]>(
    () => [
      col.accessor('username', {
        header: () => t('sessions.colUser'),
        cell: ({ row }) => (
          <div>
            <div className="flex items-center gap-1.5 font-semibold text-ink">
              {row.original.username}
              {row.original.viaPasskey && <Pill tone="blue">{t('sessions.passkey')}</Pill>}
              {row.original.impersonatedBy && (
                <Pill tone="amber">{t('sessions.impersonatedBy', { name: row.original.impersonatedBy })}</Pill>
              )}
            </div>
            <div className="text-[11px] text-mute">{tu(`role.${row.original.role}`)}</div>
          </div>
        ),
      }),
      col.accessor('ip', {
        header: () => t('sessions.colIp'),
        cell: ({ getValue }) => <span className="font-mono text-brand-pale">{getValue() ?? '-'}</span>,
      }),
      col.accessor('id', {
        header: () => t('sessions.colId'),
        cell: ({ getValue }) => (
          <span className="font-mono text-[11.5px] text-mute" title={t('sessions.idHint')}>
            {getValue().slice(0, 8)}…{getValue().slice(-6)}
          </span>
        ),
      }),
      col.accessor('userAgent', {
        header: () => t('sessions.colDevice'),
        cell: ({ getValue }) => (
          <span className="block max-w-[180px] truncate text-[11.5px] text-ink-2" title={getValue() ?? ''}>
            {getValue() ?? '-'}
          </span>
        ),
      }),
      col.accessor('createdAt', {
        header: () => t('sessions.colCreated'),
        cell: ({ getValue }) => <span className="text-xs text-mute">{formatDateTime(getValue())}</span>,
      }),
      col.display({
        id: 'actions',
        header: () => t('sessions.colActions'),
        cell: ({ row }) =>
          row.original.isCurrent ? (
            <span className="text-[11.5px] font-semibold text-positive">({t('sessions.current')})</span>
          ) : (
            row.original.canRevoke && (
              <button
                type="button"
                disabled={revoke.isPending}
                className="cursor-pointer rounded-md border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.15)] px-2 py-1 text-[11px] text-danger hover:bg-[rgba(239,68,68,0.25)] disabled:opacity-50"
                onClick={() => revoke.mutate(row.original.id)}
              >
                {t('sessions.revoke')}
              </button>
            )
          ),
      }),
    ],
    [t, tu, revoke],
  );

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={t('sessions.title')}
        description={t('sessions.description')}
        actions={
          <>
            <Pill tone="gray">{t('sessions.count', { count: sessions?.length ?? 0 })}</Pill>
            <SettingsButton tone="ghost" disabled={isFetching} onClick={() => void refetch()}>
              <Icon name="refresh" className="size-3.5" />
              {t('common.refresh')}
            </SettingsButton>
          </>
        }
      />
      <DataTable
        columns={columns}
        data={sessions}
        loading={isLoading}
        getRowId={(s) => s.id}
        empty={t('sessions.empty')}
      />
    </SettingsCard>
  );
}
