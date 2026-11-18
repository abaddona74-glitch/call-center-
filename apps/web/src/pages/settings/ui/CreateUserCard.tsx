import { CreateUserSchema, type OperatorGroup, ROLES, type Role } from '@cc/shared';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { createUser, userKeys } from '@/entities/user';
import { IconUser } from '@/shared/ui/inline-icons';
import {
  FieldError,
  FieldLabel,
  SettingsButton,
  SettingsCard,
  SettingsCardHeader,
  SettingsInput,
  SettingsSelect,
} from '@/shared/ui/settings-panel';
import { Switch } from '@/shared/ui/switch';
import { userErrorText } from '../model/errors';

type Values = {
  username: string;
  password: string;
  role: Role;
  extension: string;
  email: string;
  groupId: number | null;
  mustChangePassword: boolean;
};

const EMPTY: Values = {
  username: '',
  password: '',
  role: 'operator',
  extension: '',
  email: '',
  groupId: null,
  // the admin picks a temporary password; the person sets their own at first login
  mustChangePassword: true,
};

/** Legacy "Yangi foydalanuvchi qo'shish" inline form. Only roles the current admin may grant are offered. */
export function CreateUserCard({ actorRole, groups }: { actorRole: Role; groups: OperatorGroup[] }) {
  const { t } = useTranslation('settings');
  const { t: tu } = useTranslation('user');
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  // only a superuser grants the superuser role (the server enforces the same)
  const grantable = ROLES.filter((r) => actorRole === 'superuser' || r !== 'superuser');

  const mutation = useMutation({
    mutationFn: (value: Values) => createUser(value),
    onSuccess: (user) => {
      toast.success(`${t('users.created')}: ${user.username}`);
      form.reset();
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      void queryClient.invalidateQueries({ queryKey: userKeys.groups });
    },
    onError: (err) => setServerError(userErrorText(err, t)),
  });

  const form = useForm({
    defaultValues: EMPTY,
    validators: {
      onSubmit: ({ value }) => {
        const parsed = CreateUserSchema.safeParse(value);
        if (parsed.success) return undefined;
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
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

  const text = (
    name: 'username' | 'password' | 'extension' | 'email',
    label: string,
    props: React.ComponentProps<'input'>,
  ) => (
    <form.Field name={name}>
      {(field) => (
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`new-${name}`}>{label}</FieldLabel>
          <SettingsInput
            id={`new-${name}`}
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
            {...props}
          />
          <FieldError>{field.state.meta.errors[0] as string | undefined}</FieldError>
        </div>
      )}
    </form.Field>
  );

  return (
    <SettingsCard>
      <SettingsCardHeader title={t('users.createTitle')} description={t('users.createText')} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {text('username', t('users.username'), { placeholder: t('users.usernamePlaceholder'), autoComplete: 'off' })}
          {text('password', t('users.password'), {
            type: 'password',
            placeholder: t('users.passwordHint'),
            autoComplete: 'new-password',
          })}
          <form.Field name="role">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="new-role">{t('users.role')}</FieldLabel>
                <SettingsSelect
                  id="new-role"
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
          {text('extension', t('users.extension'), { inputMode: 'numeric', placeholder: '101' })}
          {text('email', t('users.email'), { type: 'email', placeholder: t('users.emailPlaceholder') })}
          <form.Subscribe selector={(s) => s.values.role}>
            {(role) =>
              role === 'operator' && (
                <form.Field name="groupId">
                  {(field) => (
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor="new-group">{t('users.group')}</FieldLabel>
                      <SettingsSelect
                        id="new-group"
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

        <form.Field name="mustChangePassword">
          {(field) => (
            <label className="flex cursor-pointer items-center gap-3 text-[13px] text-ink-2">
              <Switch checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
              {t('users.mustChange')}
            </label>
          )}
        </form.Field>
        <FieldError>{serverError}</FieldError>
        <div className="flex justify-end">
          <SettingsButton type="submit" tone="success" disabled={mutation.isPending}>
            <IconUser size={16} />
            {t('users.add')}
          </SettingsButton>
        </div>
      </form>
    </SettingsCard>
  );
}
