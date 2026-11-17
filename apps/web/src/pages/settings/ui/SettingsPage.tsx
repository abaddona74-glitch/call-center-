import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/** Placeholder — users, sessions, security settings come with the auth slice. */
export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('nav.settings')}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground">{t('common.comingSoon')}</CardContent>
    </Card>
  );
}
