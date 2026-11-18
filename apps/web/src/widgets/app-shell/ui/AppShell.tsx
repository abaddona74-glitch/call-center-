import { hasPermission } from '@cc/shared';
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
import { OnlineUsers } from '@/features/presence/online-users';
import { TicketAlerts } from '@/features/tickets/notifications';
import { NAV_ITEMS } from '../model/nav';

export function AppShell() {
  const { t, i18n } = useTranslation();
  const user = useSessionUser();
  const status = useRealtimeStatus();
  useExcludedOperatorsSync();
  const items = NAV_ITEMS.filter(
    (item) => !item.permission || [item.permission].flat().some((p) => hasPermission(user, p)),
  );

  return (
    <div className="flex min-h-svh">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card">
        <div className="px-5 py-4 text-lg font-semibold">{t('app.title')}</div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b px-6">
          <OnlineUsers />
          <TicketAlerts meId={user.id} />
          <Badge
            variant="outline"
            className={cn(status === 'open' ? 'text-success' : 'text-warning')}
            title="WebSocket"
          >
            {t(`realtime.${status}`)}
          </Badge>
          <select
            className="rounded-md border bg-transparent px-2 py-1 text-sm"
            value={i18n.language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            aria-label="Language"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          <span className="text-sm">
            {user.username} <span className="text-muted-foreground">· {t(`roles.${user.role}`)}</span>
          </span>
          <LogoutButton />
        </header>
        <ImpersonationBanner />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
