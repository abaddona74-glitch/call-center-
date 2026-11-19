import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { ImpersonationBanner } from '@/features/auth/impersonation';
import { LogoutButton } from '@/features/auth/logout';
import { useExcludedOperatorsSync } from '@/features/excluded-operators/edit';
import { useRealtimeStatus } from '@/shared/api';
import { type Language, LANGUAGES, setLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { NativeSelect } from '@/shared/ui/native-select';
import { OnlineUsers } from '@/features/presence/online-users';
import { TicketAlerts } from '@/features/tickets/notifications';
import { ThemeSwitch } from '@/features/theme-switch';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const { t, i18n } = useTranslation();
  const user = useSessionUser();
  const status = useRealtimeStatus();
  useExcludedOperatorsSync();

  return (
    <div className="flex min-h-svh">
      <Sidebar />

      {/* A docked right panel ([data-right-dock], e.g. "Jonli Monitor") is fixed to the viewport
          edge from xl up; reserve its width so the header and the page stop where it starts. */}
      <div className="flex min-w-0 flex-1 flex-col xl:has-[[data-right-dock]]:pr-(--right-dock-width)">
        <header className="flex h-14 items-center justify-end gap-2 border-b px-3 sm:gap-3 md:px-6">
          {/* Phones: no sidebar, the title goes to the header and the menu below it. */}
          <div className="mr-auto truncate font-semibold md:hidden">{t('app.title')}</div>
          {/* Phones: no room next to the title (the superuser's pill squeezed it to one letter). */}
          <div className="hidden sm:contents">
            <OnlineUsers />
          </div>
          <TicketAlerts meId={user.id} />
          <Badge
            variant="outline"
            className={cn(status === 'open' ? 'text-success' : 'text-warning')}
            title="WebSocket"
          >
            {t(`realtime.${status}`)}
          </Badge>
          <ThemeSwitch />
          <NativeSelect
            className="text-sm"
            value={i18n.language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            aria-label="Language"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </NativeSelect>
          <span className="hidden text-sm sm:inline">
            {user.username} <span className="text-muted-foreground">· {t(`roles.${user.role}`)}</span>
          </span>
          <LogoutButton />
        </header>
        <MobileNav />
        <ImpersonationBanner />
        <main className="min-w-0 flex-1 p-3 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
