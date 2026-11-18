import { CreateUserSchema, type OperatorGroup, ROLES, type Role, UpdateUserSchema, type User } from '@cc/shared';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { createUser, updateUser, userKeys } from '@/entities/user';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  SettingsButton,
  SettingsInput,
  SettingsSelect,
} from '@/shared/ui/settings-panel';
import { Switch } from '@/shared/ui/switch';
import { userErrorText } from '../model/errors';

const dialogClass =
  'border-tint/12 bg-[linear-gradient(160deg,var(--glass-2)_0%,var(--sidebar)_100%)] text-ink shadow-[0_25px_60px_color-mix(in_srgb,var(--shadow-color)_65%,transparent)] sm:max-w-xl';

/** Create (user = null) or edit a user. Only roles the current admin may grant are offered. */
export function UserDialog({
  open,
  onOpenChange,
  user,
  actorRole,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  actorRole: Role;
  groups: OperatorGroup[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClass}>
        {open && <UserForm user={user} actorRole={actorRole} groups={groups} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function UserForm({
  user,
  actorRole,
  groups,
  onDone,
}: {
  user: User | null;
  actorRole: Role;
  groups: OperatorGroup[];
  onDone: () => void;
}) {
  const { t } = useTranslation('settings');
  const { t: tu } = useTranslation('user');
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const grantable = ROLES.filter((r) => actorRole === 'superuser' || r !== 'superuser');

  const mutation = useMutation({
    mutationFn: async (value: Values) => {
      if (!user) {
        return createUser({ ...value, groupId: value.groupId });
      }
      const patch: Record<string, unknown> = {};
      if (value.username !== user.username) patch.username = value.username;
      if (value.role !== user.role) patch.role = value.role;
      if ((value.extension || null) !== user.extension) patch.extension = value.extension;
      if ((value.email.trim().toLowerCase() || null) !== user.email) patch.email = value.email;
      if (value.groupId !== user.groupId) patch.groupId = value.groupId;
      if (value.isActive !== user.isActive) patch.isActive = value.isActive;
      if (value.mustChangePassword !== user.mustChangePassword) patch.mustChangePassword = value.mustChangePassword;
      if (Object.keys(patch).length === 0) return user;
      return updateUser(user.id, UpdateUserSchema.parse(patch));
    },
    onSuccess: () => {
      toast.success(user ? t('users.updated') : t('users.created'));
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      void queryClient.invalidateQueries({ queryKey: userKeys.groups });
      onDone();
    },
    onError: (err) => setServerError(userErrorText(err, t)),
  });

  type Values = {
    username: string;
    password: string;
    role: Role;
    extension: string;
    email: string;
    groupId: number | null;
    isActive: boolean;
    mustChangePassword: boolean;
  };

  const form = useForm({
    defaultValues: {
      username: user?.username ?? '',
      password: '',
      role: user?.role ?? 'operator',
      extension: user?.extension ?? '',
      email: user?.email ?? '',
      groupId: user?.groupId ?? null,
      isActive: user?.isActive ?? true,
      mustChangePassword: user?.mustChangePassword ?? false,
    } as Values,
    validators: {
      onSubmit: ({ value }) => {
        const schema = user
          ? CreateUserSchema.safeParse({ ...value, password: 'x'.repeat(10) })
          : CreateUserSchema.safeParse(value);
        if (schema.success) return undefined;
        const fields: Record<string, string> = {};
        for (const issue of schema.error.issues) {
          const key = String(issue.path[0] ?? '');
          if (key && !fields[key]) fields[key] = t(`users.errors.${key}` as 'users.errors.username');
        }
        return { fields };
      },
    },
    onSubmit: ({ value }) => {
      setServerError(null);
      return mutation.mutateAsync(value).catch(() => undefined);
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('users.dialogEdit')}</DialogTitle>
        <DialogDescription className="text-mute">{t('users.dialogText')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <form.Field name="username">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="u-username">{t('users.username')}</FieldLabel>
              <SettingsInput
                id="u-username"
                autoComplete="off"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError>{field.state.meta.errors[0] as string | undefined}</FieldError>
            </div>
          )}
        </form.Field>

        {!user && (
          <form.Field name="password">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="u-password">{t('users.password')}</FieldLabel>
                <SettingsInput
                  id="u-password"
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError>{field.state.meta.errors[0] as string | undefined}</FieldError>
                {field.state.meta.errors.length === 0 && <FieldHint>{t('users.passwordHint')}</FieldHint>}
              </div>
            )}
          </form.Field>
        )}

        <form.Field name="role">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="u-role">{t('users.role')}</FieldLabel>
              <SettingsSelect
                id="u-role"
                value={field.state.value}
                disabled={grantable.length === 1}
                onChange={(e) => field.handleChange(e.target.value as Role)}
              >
                {grantable.map((r) => (
                  <option key={r} value={r}>
                    {tu(`role.${r}`)}
                  </option>
                ))}
              </SettingsSelect>
            </div>
          )}
        </form.Field>

        <form.Field name="extension">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="u-extension">{t('users.extension')}</FieldLabel>
              <SettingsInput
                id="u-extension"
                inputMode="numeric"
                placeholder="101"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError>{field.state.meta.errors[0] as string | undefined}</FieldError>
              {field.state.meta.errors.length === 0 && <FieldHint>{t('users.extensionHint')}</FieldHint>}
            </div>
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="u-email">{t('users.email')}</FieldLabel>
              <SettingsInput
                id="u-email"
                type="email"
                placeholder="misol@gmail.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError>{field.state.meta.errors[0] as string | undefined}</FieldError>
            </div>
          )}
        </form.Field>

        <form.Subscribe selector={(s) => s.values.role}>
          {(role) =>
            role === 'operator' && (
              <form.Field name="groupId">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor="u-group">{t('users.group')}</FieldLabel>
                    <SettingsSelect
                      id="u-group"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">{tu('noGroup')}</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </SettingsSelect>
                  </div>
                )}
              </form.Field>
            )
          }
        </form.Subscribe>
      </div>

      {user && (
        <form.Field name="isActive">
          {(field) => (
            <label className="flex cursor-pointer items-center gap-3 text-[13px] text-ink-2">
              <Switch checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
              {t('users.active')}
            </label>
          )}
        </form.Field>
      )}
      <form.Field name="mustChangePassword">
        {(field) => (
          <label className="flex cursor-pointer items-center gap-3 text-[13px] text-ink-2">
            <Switch checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
            {t('users.mustChange')}
          </label>
        )}
      </form.Field>

      <FieldError>{serverError}</FieldError>
      <div className="flex justify-end gap-2">
        <SettingsButton tone="ghost" onClick={onDone}>
          {t('common.cancel')}
        </SettingsButton>
        <SettingsButton type="submit" tone={user ? 'primary' : 'success'} disabled={mutation.isPending}>
          {user ? t('common.save') : t('users.add')}
        </SettingsButton>
      </div>
    </form>
  );
}
