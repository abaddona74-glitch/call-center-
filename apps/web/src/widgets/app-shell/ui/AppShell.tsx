import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { ImpersonationBanner } from '@/features/auth/impersonation';
import { LogoutButton } from '@/features/auth/logout';
import { useExcludedOperatorsSync } from '@/features/excluded-operators/edit';
import { OnlineUsers } from '@/features/presence/online-users';
import { TicketAlerts } from '@/features/tickets/notifications';
import { LanguageSwitch } from '@/features/language-switch';
import { ThemeSwitch } from '@/features/theme-switch';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';

/**
 * Sidebar + page. From `md` up there is no top header: its controls (online, theme, language, user) sit at
 * the sidebar's foot. Phones have no sidebar, so they keep a slim header with the title and those controls,
 * and the pages as a strip under it. Only one of the two is mounted, so presence and ticket alerts run once.
 */
export function AppShell() {
  useExcludedOperatorsSync();
  const desktop = useMediaQuery('(min-width: 768px)');

  return (
    <div className="flex min-h-svh">
      <Sidebar footer={desktop} />

      {/* A docked right panel ([data-right-dock], e.g. "Jonli Monitor") is fixed to the viewport
          edge from xl up; reserve its width so the page stops where it starts. While the panel slides
          in or out ([data-dock-motion]) the page widens/narrows with it instead of jumping. */}
      <div className="flex min-w-0 flex-1 flex-col ease-dock has-[[data-dock-motion]]:transition-[padding] has-[[data-dock-motion]]:duration-320 xl:has-[[data-right-dock]]:pr-(--right-dock-width)">
        {!desktop && (
          <>
            <PhoneHeader />
            <MobileNav />
          </>
        )}
        <ImpersonationBanner />
        <main className="min-w-0 flex-1 p-3 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Phones only (below `md`): the title and the sidebar-foot controls in one row. */
function PhoneHeader() {
  const { t } = useTranslation();
  const user = useSessionUser();
  return (
    <header className="flex h-14 items-center justify-end gap-2 border-b px-3">
      <div className="mr-auto truncate font-semibold">{t('app.title')}</div>
      {/* Mounted on every phone (it also sends this user's presence ping); the pill shows from `sm`. */}
      <div className="hidden sm:contents">
        <OnlineUsers />
      </div>
      <TicketAlerts meId={user.id} compact />
      <ThemeSwitch />
      <LanguageSwitch />
      <LogoutButton compact />
    </header>
  );
}
