import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { LogoutButton } from '@/features/auth/logout';
import { LanguageSwitch } from '@/features/language-switch';
import { OnlineUsers } from '@/features/presence/online-users';
import { ThemeSwitch } from '@/features/theme-switch';
import { TicketAlerts } from '@/features/tickets/notifications';
import { useRealtimeStatus } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

/**
 * The foot of the sidebar (was the top header): online users, ticket alerts, theme, language, and the
 * signed-in user with the realtime status as a dot on the avatar and the sign-out button.
 * Open sidebar: two rows. Icon rail: one centered column, names in tooltips.
 */
export function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const user = useSessionUser();
  const status = useRealtimeStatus();
  const statusText = t(`realtime.${status}`);
  const roleText = t(`roles.${user.role}`);
  const tipSide = collapsed ? 'right' : 'top';

  const language = <LanguageSwitch />;

  const avatar = (
    <span
      className="relative grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary uppercase"
      aria-hidden={!collapsed || undefined}
      tabIndex={collapsed ? 0 : undefined}
      aria-label={collapsed ? `${user.username} · ${roleText} · ${statusText}` : undefined}
    >
      {user.username.slice(0, 1)}
      <span
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card',
          status === 'open' ? 'bg-success' : 'bg-warning',
        )}
      />
    </span>
  );

  const logout = (
    <Tip label={t('auth.signOut')} side={tipSide}>
      <LogoutButton compact className="cursor-pointer text-muted-foreground hover:text-foreground" />
    </Tip>
  );

  // One tree for both widths (only classes change), so folding the rail doesn't remount the presence
  // ping or the ticket-alert listeners.
  const row = cn('flex items-center', collapsed ? 'flex-col gap-2' : 'gap-1.5');
  return (
    <div className={cn('flex shrink-0 flex-col gap-2 border-t px-3 py-3', collapsed && 'items-center')}>
      <div className={row}>
        <OnlineUsers compact={collapsed} />
        <TicketAlerts meId={user.id} compact />
        {!collapsed && <span className="flex-1" />}
        <ThemeSwitch />
        {language}
      </div>
      <div className={cn(row, !collapsed && 'gap-2.5 pl-1')}>
        {collapsed ? (
          <Tip label={`${user.username} · ${roleText} · ${statusText}`} side="right">
            {avatar}
          </Tip>
        ) : (
          <>
            <span title={statusText}>{avatar}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{user.username}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {roleText} · <span className={status === 'open' ? 'text-success' : 'text-warning'}>{statusText}</span>
              </span>
            </span>
          </>
        )}
        {logout}
      </div>
    </div>
  );
}

function Tip({ label, side, children }: { label: string; side: 'right' | 'top'; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
