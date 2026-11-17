import type { SessionInfo } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RoleBadge } from '@/entities/user';
import { describeUserAgent, formatDateTime } from '@/shared/lib/format-datetime';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import { Pill, SettingsButton, SettingsCard, SettingsCardHeader } from '@/shared/ui/settings-panel';
import { adminKeys, adminSessionsQuery, revokeSession } from '../api/admin.queries';

const col = dataTableColumns<SessionInfo>();

export function SessionsSettingsPage() {
  const { t } = useTranslation('settings');
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
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-[#e2e8f0]">{row.original.username}</span>
            <RoleBadge role={row.original.role} />
            {row.original.isCurrent && <Pill tone="green">{t('sessions.current')}</Pill>}
            {row.original.viaPasskey && <Pill tone="blue">{t('sessions.passkey')}</Pill>}
          </div>
        ),
      }),
      col.accessor('ip', {
        header: () => t('sessions.colIp'),
        cell: ({ getValue }) => <span className="font-mono text-[11px] text-[#38bdf8]">{getValue() ?? '—'}</span>,
      }),
      col.accessor('id', {
        header: () => t('sessions.colId'),
        cell: ({ getValue }) => (
          <code className="inline-flex max-w-[140px] items-center overflow-hidden rounded-[5px] border border-[rgba(56,189,248,0.2)] bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-ellipsis whitespace-nowrap text-[#38bdf8]">
            {getValue().slice(0, 12)}…
          </code>
        ),
      }),
      col.accessor('userAgent', {
        header: () => t('sessions.colDevice'),
        cell: ({ getValue }) => <span title={getValue() ?? ''}>{describeUserAgent(getValue())}</span>,
      }),
      col.accessor('createdAt', { header: () => t('sessions.colCreated'), cell: ({ getValue }) => formatDateTime(getValue()) }),
      col.accessor('lastSeenAt', { header: () => t('sessions.colSeen'), cell: ({ getValue }) => formatDateTime(getValue()) }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.canRevoke && (
            <SettingsButton size="sm" tone="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(row.original.id)}>
              {t('sessions.revoke')}
            </SettingsButton>
          ),
      }),
    ],
    [t, revoke],
  );

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Icon name="monitor" className="size-5" />}
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
      <DataTable columns={columns} data={sessions} loading={isLoading} getRowId={(s) => s.id} empty={t('sessions.empty')} />
    </SettingsCard>
  );
}
