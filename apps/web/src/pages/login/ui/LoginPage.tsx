import { useTranslation } from 'react-i18next';
import { LoginForm } from '@/features/auth/login-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('app.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm onSuccess={onLoggedIn} />
        </CardContent>
      </Card>
    </div>
  );
}
