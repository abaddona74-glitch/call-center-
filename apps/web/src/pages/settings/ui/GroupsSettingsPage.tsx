import { ALL_GROUP_FLAGS, GROUP_FLAGS, type GroupFlags, type OperatorGroup } from '@cc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  createOperatorGroup,
  deleteOperatorGroup,
  operatorGroupsQuery,
  updateOperatorGroup,
  userKeys,
} from '@/entities/user';
import { isHttpError } from '@/shared/api';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Icon } from '@/shared/ui/icon';
import { IconPeople } from '@/shared/ui/inline-icons';
import {
  FieldError,
  FieldLabel,
  Pill,
  SettingsButton,
  SettingsCard,
  SettingsCardHeader,
  SettingsInput,
} from '@/shared/ui/settings-panel';
import { Switch } from '@/shared/ui/switch';

export function GroupsSettingsPage() {
  const { t } = useTranslation('settings');
  const { t: tu } = useTranslation('user');
  const queryClient = useQueryClient();
  const { data: groups } = useQuery(operatorGroupsQuery);
  const [editing, setEditing] = useState<OperatorGroup | 'new' | null>(null);
  const [removing, setRemoving] = useState<OperatorGroup | null>(null);

  const remove = useMutation({
    mutationFn: (g: OperatorGroup) => deleteOperatorGroup(g.id),
    onSuccess: () => {
      toast.success(t('groups.deleted'));
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: userKeys.groups });
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<IconPeople size={20} />}
        title={t('groups.title')}
        description={t('groups.description')}
        actions={
          <SettingsButton tone="success" onClick={() => setEditing('new')}>
            + {t('groups.create')}
          </SettingsButton>
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        {groups?.map((g) => (
          <div
            key={g.id}
            className="flex flex-col gap-3 rounded-xl border border-tint/[0.07] bg-glass-2/50 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-ink">
                  {g.name}
                  <Pill tone="gray">{t('groups.members', { count: g.memberCount })}</Pill>
                </div>
                {g.description && <p className="mt-0.5 text-xs text-mute">{g.description}</p>}
              </div>
              <div className="flex gap-1">
                <SettingsButton size="sm" tone="ghost" title={t('common.edit')} onClick={() => setEditing(g)}>
                  <Icon name="edit" className="size-3.5" />
                </SettingsButton>
                <SettingsButton size="sm" tone="danger" title={t('common.delete')} onClick={() => setRemoving(g)}>
                  <Icon name="trash" className="size-3.5" />
                </SettingsButton>
              </div>
            </div>
            <ul className="flex flex-col gap-1.5">
              {GROUP_FLAGS.map((flag) => (
                <li key={flag} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-2">{tu(`permission.${flag}`)}</span>
                  {g.permissions[flag] ? (
                    <Pill tone="green">{t('common.yes')}</Pill>
                  ) : (
                    <Pill tone="red">{t('common.no')}</Pill>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <GroupDialog group={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('groups.deleteTitle')}
        description={t('groups.deleteText', { name: removing?.name ?? '', count: removing?.memberCount ?? 0 })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </SettingsCard>
  );
}

function GroupDialog({ group, onClose }: { group: OperatorGroup | 'new' | null; onClose: () => void }) {
  return (
    <Dialog open={group !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-tint/12 bg-[linear-gradient(160deg,var(--glass-2)_0%,var(--sidebar)_100%)] text-ink sm:max-w-lg">
        {group !== null && <GroupForm group={group === 'new' ? null : group} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function GroupForm({ group, onDone }: { group: OperatorGroup | null; onDone: () => void }) {
  const { t } = useTranslation('settings');
  const { t: tu } = useTranslation('user');
  const queryClient = useQueryClient();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [permissions, setPermissions] = useState<GroupFlags>(group?.permissions ?? ALL_GROUP_FLAGS);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      group
        ? updateOperatorGroup(group.id, { name: name.trim(), description, permissions })
        : createOperatorGroup({ name: name.trim(), description, permissions }),
    onSuccess: () => {
      toast.success(t('groups.saved'));
      void queryClient.invalidateQueries({ queryKey: userKeys.groups });
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      onDone();
    },
    onError: (err) =>
      setError(
        isHttpError(err, 409) ? t('groups.taken') : isHttpError(err, 400) ? t('groups.nameError') : t('common.failed'),
      ),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (n.length < 2 || n.length > 60) return setError(t('groups.nameError'));
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{group ? t('groups.dialogEdit') : t('groups.dialogCreate')}</DialogTitle>
        <DialogDescription className="text-mute">{t('groups.description')}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="g-name">{t('groups.name')}</FieldLabel>
        <SettingsInput id="g-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="g-desc">{t('groups.descriptionLabel')}</FieldLabel>
        <SettingsInput
          id="g-desc"
          value={description}
          maxLength={300}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>{t('groups.permissions')}</FieldLabel>
        <div className="flex flex-col gap-1 rounded-[10px] border border-tint/[0.07] bg-glass/40 p-1.5">
          {GROUP_FLAGS.map((flag) => (
            <label
              key={flag}
              className="flex cursor-pointer items-center justify-between rounded-lg border border-tint/5 bg-glass-2/50 px-3 py-2 text-[13px] text-foreground hover:bg-glass-2/80"
            >
              {tu(`permission.${flag}`)}
              <Switch
                checked={permissions[flag]}
                onCheckedChange={(v) => setPermissions((p) => ({ ...p, [flag]: v }))}
                aria-label={tu(`permission.${flag}`)}
              />
            </label>
          ))}
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <div className="flex justify-end gap-2">
        <SettingsButton tone="ghost" onClick={onDone}>
          {t('common.cancel')}
        </SettingsButton>
        <SettingsButton type="submit" disabled={save.isPending}>
          {t('common.save')}
        </SettingsButton>
      </div>
    </form>
  );
}
