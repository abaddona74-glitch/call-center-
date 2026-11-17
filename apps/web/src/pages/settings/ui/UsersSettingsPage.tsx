import type { User } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSessionUser } from '@/entities/session';
import { RoleBadge, deleteUser, operatorGroupsQuery, userKeys, usersQuery } from '@/entities/user';
import { formatDateTime } from '@/shared/lib/format-datetime';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import { IconUser } from '@/shared/ui/inline-icons';
import { Pill, SettingsButton, SettingsCard, SettingsCardHeader, SettingsInput } from '@/shared/ui/settings-panel';
import { Switch } from '@/shared/ui/switch';
import { userErrorText } from '../model/errors';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { UserDialog } from './UserDialog';

const col = dataTableColumns<User>();

export function UsersSettingsPage() {
  const { t } = useTranslation('settings');
  const { t: tu } = useTranslation('user');
  const me = useSessionUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());
  const { data: users, isLoading } = useQuery(
    usersQuery({ search: deferredSearch || undefined, active: onlyActive ? true : undefined }),
  );
  const { data: groups = [] } = useQuery(operatorGroupsQuery);

  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);

  const remove = useMutation({
    mutationFn: (u: User) => deleteUser(u.id),
    onSuccess: () => {
      toast.success(t('users.deleted'));
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
    onError: (err) => toast.error(userErrorText(err, t)),
  });

  const columns = useMemo<DataTableColumn<User>[]>(
    () => [
      col.accessor('username', {
        header: () => t('users.colUser'),
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex items-center gap-2">
              <span className={u.isActive ? 'font-semibold text-[#e2e8f0]' : 'font-semibold text-[#64748b] line-through'}>
                {u.username}
              </span>
              {u.id === me.id && <Pill tone="blue">{t('sessions.current')}</Pill>}
              {!u.isActive && <Pill tone="red">{t('users.inactive')}</Pill>}
            </div>
          );
        },
      }),
      col.accessor('role', { header: () => t('users.colRole'), cell: ({ getValue }) => <RoleBadge role={getValue()} /> }),
      col.accessor('extension', {
        header: () => t('users.colExtension'),
        cell: ({ getValue }) =>
          getValue() ? <span className="font-semibold text-[#38bdf8]">{getValue()}</span> : <span className="text-[#64748b]">—</span>,
      }),
      col.accessor('groupName', {
        header: () => t('users.colGroup'),
        cell: ({ row }) =>
          row.original.role !== 'operator' ? (
            <span className="text-[#64748b]">—</span>
          ) : row.original.groupName ? (
            <Pill tone="purple">{row.original.groupName}</Pill>
          ) : (
            <span className="text-[#94a3b8]">{tu('noGroup')}</span>
          ),
      }),
      col.accessor('email', {
        header: () => t('users.colEmail'),
        cell: ({ getValue }) => <span className="text-[#cbd5e1]">{getValue() ?? '—'}</span>,
      }),
      col.accessor('lastLoginAt', {
        header: () => t('users.colLastLogin'),
        cell: ({ row }) => (
          <div className="leading-tight">
            <div>{formatDateTime(row.original.lastLoginAt)}</div>
            <div className="text-[10.5px] text-[#64748b]">
              {t('users.sessions', { count: row.original.activeSessions })} · {t('users.passkeys', { count: row.original.passkeyCount })}
            </div>
          </div>
        ),
      }),
      col.accessor('createdAt', { header: () => t('users.colCreated'), cell: ({ getValue }) => formatDateTime(getValue()) }),
      col.display({
        id: 'actions',
        header: () => t('users.colActions'),
        cell: ({ row }) => {
          const u = row.original;
          if (!u.canManage) return <span className="text-[11px] text-[#64748b]">{u.id === me.id ? '' : t('users.readOnly')}</span>;
          return (
            <div className="flex justify-end gap-1">
              <SettingsButton size="sm" tone="ghost" title={t('common.edit')} onClick={() => setEditing(u)}>
                <Icon name="edit" className="size-3.5" />
              </SettingsButton>
              <SettingsButton size="sm" tone="ghost" title={t('users.resetPassword')} onClick={() => setResetting(u)}>
                <Icon name="unlock" className="size-3.5" />
              </SettingsButton>
              <SettingsButton size="sm" tone="danger" title={t('common.delete')} onClick={() => setRemoving(u)}>
                <Icon name="trash" className="size-3.5" />
              </SettingsButton>
            </div>
          );
        },
      }),
    ],
    [t, tu, me.id],
  );

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<IconUser size={20} />}
        title={t('users.title')}
        description={t('users.description')}
        actions={
          <>
            <SettingsInput
              className="w-48"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('common.search')}
            />
            <label className="flex items-center gap-2 text-xs text-[#94a3b8]">
              <Switch checked={onlyActive} onCheckedChange={setOnlyActive} />
              {t('users.onlyActive')}
            </label>
            <SettingsButton tone="success" onClick={() => setCreating(true)}>
              + {t('users.create')}
            </SettingsButton>
          </>
        }
      />
      <DataTable columns={columns} data={users} loading={isLoading} getRowId={(u) => String(u.id)} empty="—" />

      <UserDialog
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        user={editing}
        actorRole={me.role}
        groups={groups}
      />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('users.deleteTitle')}
        description={t('users.deleteText', { name: removing?.username ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </SettingsCard>
  );
}
