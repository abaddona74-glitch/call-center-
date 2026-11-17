import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/** Placeholder — the live dashboard (operators, queues, active calls) is built in the telephony slice. */
export function DashboardPage() {
  const { t } = useTranslation();
  const user = useSessionUser();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('nav.dashboard')}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        {user.username} — {t('common.comingSoon')}
      </CardContent>
    </Card>
  );
}
