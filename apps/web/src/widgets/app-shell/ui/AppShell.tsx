import { Link, Outlet } from '@tanstack/react-router';
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
import { visibleNavItems } from '../model/nav';

export function AppShell() {
  const { t, i18n } = useTranslation();
  const user = useSessionUser();
  const status = useRealtimeStatus();
  useExcludedOperatorsSync();
  const items = visibleNavItems(user);

  return (
    <div className="flex min-h-svh">
      {/* Pinned to the viewport: the page scrolls, the sidebar stays put. A menu taller than
          the screen scrolls inside the nav instead. z-30: above page content (animating
          operator cards, z-10 sticky headers), below overlays (z-40 dock/banner, z-50 dialogs). */}
      <aside className="sticky top-0 z-30 hidden h-svh w-60 shrink-0 flex-col self-start border-r bg-card md:flex">
        <div className="px-5 py-4 text-lg font-semibold">{t('app.title')}</div>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === '/' }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              activeProps={{ className: 'bg-accent text-foreground' }}
            >
              <Icon className="size-4" />
              {t(label)}
            </Link>
          ))}
        </nav>
      </aside>

      {/* A docked right panel ([data-right-dock], e.g. "Jonli Monitor") is fixed to the viewport
          edge from xl up; reserve its width so the header and the page stop where it starts. */}
      <div className="flex min-w-0 flex-1 flex-col xl:has-[[data-right-dock]]:pr-(--right-dock-width)">
        <header className="flex h-14 items-center justify-end gap-2 border-b px-3 sm:gap-3 md:px-6">
          {/* Phones: no sidebar, the title goes to the header and the menu below it. */}
          <div className="mr-auto truncate font-semibold md:hidden">{t('app.title')}</div>
          <OnlineUsers />
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
        <nav className="flex gap-1 overflow-x-auto border-b px-2 py-1.5 md:hidden">
          {items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === '/' }}
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground"
              activeProps={{ className: 'bg-accent text-foreground' }}
            >
              <Icon className="size-4" />
              {t(label)}
            </Link>
          ))}
        </nav>
        <ImpersonationBanner />
        <main className="min-w-0 flex-1 p-3 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
