import { LoginRequestSchema } from '@cc/shared';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { login, sessionKeys } from '@/entities/session';
import { isHttpError } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (res) => {
      queryClient.setQueryData(sessionKeys.me, res.user);
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { username: '', password: '' },
    validators: { onSubmit: LoginRequestSchema },
    onSubmit: ({ value }) => mutation.mutateAsync(value).catch(() => undefined),
  });

  const errorText = mutation.error
    ? isHttpError(mutation.error, 429)
      ? t('auth.tooManyAttempts')
      : isHttpError(mutation.error, 401)
        ? t('auth.invalidCredentials')
        : t('common.error')
    : null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="username">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor={field.name}>{t('auth.username')}</Label>
            <Input
              id={field.name}
              autoComplete="username"
              autoFocus
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor={field.name}>{t('auth.password')}</Label>
            <Input
              id={field.name}
              type="password"
              autoComplete="current-password"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
          </div>
        )}
      </form.Field>
      {errorText && <p className="text-sm text-destructive" role="alert">{errorText}</p>}
      <form.Subscribe selector={(s) => s.canSubmit}>
        {(canSubmit) => (
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {t('auth.signIn')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
