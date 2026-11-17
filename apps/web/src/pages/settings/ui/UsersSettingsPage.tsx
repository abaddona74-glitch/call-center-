import type { User } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSessionUser } from '@/entities/session';
import { RoleBadge, deleteUser, operatorGroupsQuery, userKeys, usersQuery } from '@/entities/user';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Pill, SettingsButton, SettingsCard, SettingsCardHeader, SettingsInput } from '@/shared/ui/settings-panel';
import { Switch } from '@/shared/ui/switch';
import { userErrorText } from '../model/errors';
import { CreateUserCard } from './CreateUserCard';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { UserDialog } from './UserDialog';

const col = dataTableColumns<User>();

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' });

/** Legacy "Foydalanuvchilar (RBAC)" tab: inline create form + users table with Parol / O'chirish. */
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
              <span
                className={u.isActive ? 'font-semibold text-[#f1f5f9]' : 'font-semibold text-[#64748b] line-through'}
              >
                {u.username}
              </span>
              {u.id === me.id && (
                <span className="text-[11.5px] font-semibold text-[#34d399]">({t('sessions.current')})</span>
              )}
              {!u.isActive && <Pill tone="red">{t('users.inactive')}</Pill>}
            </div>
          );
        },
      }),
      col.accessor('role', {
        header: () => t('users.colRole'),
        cell: ({ getValue }) => <RoleBadge role={getValue()} />,
      }),
      col.accessor('extension', {
        header: () => t('users.colExtension'),
        cell: ({ getValue }) =>
          getValue() ? (
            <b className="text-[#f1f5f9]">{getValue()}</b>
          ) : (
            <span className="text-[#64748b]">{t('users.none')}</span>
          ),
      }),
      col.accessor('groupName', {
        header: () => t('users.colGroup'),
        cell: ({ row }) =>
          row.original.role !== 'operator' ? (
            <span className="text-[#64748b]">—</span>
          ) : row.original.groupName ? (
            <Pill tone="purple">{row.original.groupName}</Pill>
          ) : (
            <span className="text-[#64748b]">{tu('noGroup')}</span>
          ),
      }),
      col.accessor('email', {
        header: () => t('users.colEmail'),
        cell: ({ getValue }) =>
          getValue() ? (
            <span className="text-[#38bdf8]">{getValue()}</span>
          ) : (
            <span className="text-[#64748b]">{t('users.notSet')}</span>
          ),
      }),
      col.accessor('createdAt', {
        header: () => t('users.colCreated'),
        cell: ({ getValue }) => <span className="text-xs text-[#94a3b8]">{formatDate(getValue())}</span>,
      }),
      col.display({
        id: 'actions',
        header: () => t('users.colActions'),
        cell: ({ row }) => {
          const u = row.original;
          if (!u.canManage) return null;
          return (
            <div className="inline-flex justify-end gap-1">
              <SettingsButton size="sm" tone="ghost" onClick={() => setEditing(u)}>
                {t('common.edit')}
              </SettingsButton>
              <button
                type="button"
                className="cursor-pointer rounded-md border border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.15)] px-2 py-1 text-[11px] text-[#60a5fa] hover:bg-[rgba(59,130,246,0.25)]"
                onClick={() => setResetting(u)}
              >
                {t('users.passwordBtn')}
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-md border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.15)] px-2 py-1 text-[11px] text-[#f87171] hover:bg-[rgba(239,68,68,0.25)]"
                onClick={() => setRemoving(u)}
              >
                {t('common.delete')}
              </button>
            </div>
          );
        },
      }),
    ],
    [t, tu, me.id],
  );

  return (
    <div className="flex flex-col gap-4">
      <CreateUserCard actorRole={me.role} groups={groups} />

      <SettingsCard>
        <SettingsCardHeader
          title={t('users.listTitle')}
          description={t('users.listText')}
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
            </>
          }
        />
        <DataTable
          variant="plain"
          columns={columns}
          data={users}
          loading={isLoading}
          getRowId={(u) => String(u.id)}
          empty={t('users.empty')}
        />
      </SettingsCard>

      <UserDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
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
    </div>
  );
}
