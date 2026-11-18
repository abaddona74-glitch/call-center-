import { type OnlineUser, telephonyAccess } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';
import { onlineUsersQuery } from '../api/online.api';
import { useOnlineUsersSync, usePresencePing } from '../model/use-presence';
import '../i18n';

// Avatar fills with dark initials: bright in both themes, so raw legacy colors rather than theme tokens.
const COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#f87171', '#2dd4bf'];
const colorOf = (id: number) => COLORS[id % COLORS.length];

function tabLabel(tab: string | null, t: (k: string) => string): string {
  if (!tab) return '—';
  const key = { '/': 'nav.dashboard', '/operators': 'nav.operators', '/settings': 'nav.settings' }[tab];
  return key ? t(key) : tab;
}

/**
 * Header "N online" pill with the list of connected users (legacy presence widget; no cursors).
 * Every user's tab reports its page; only roles allowed to see the list get the pill.
 */
export function OnlineUsers() {
  usePresencePing();
  useOnlineUsersSync();
  const user = useSessionUser();
  const allowed = telephonyAccess(user).seeAll;
  const { t } = useTranslation('onlineUsers');
  const { t: tc } = useTranslation();
  const { data: list = [] } = useQuery({ ...onlineUsersQuery, enabled: allowed });
  if (!allowed) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-tint/10 bg-tint/5 px-3 py-1 text-xs font-semibold text-ink-2 hover:bg-tint/10"
          aria-label={t('title')}
        >
          <span className="relative inline-flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#10b981] opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-[#10b981]" />
          </span>
          {t('count', { n: list.length })}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 border-tint/10 bg-sidebar/95 p-0 backdrop-blur-md">
        <div className="border-b border-tint/8 px-4 py-3 text-sm font-semibold">{t('title')}</div>
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {list.map((u: OnlineUser) => (
            <li key={u.userId} className="flex items-center gap-3 px-4 py-2">
              <span
                className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold text-[#0f172a]"
                style={{ background: colorOf(u.userId) }}
              >
                {u.username.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {u.username}
                  {u.userId === user.id && (
                    <span className="ml-1.5 rounded bg-tint/10 px-1.5 text-[10px] text-ink-2">{t('me')}</span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {tc(`roles.${u.role}`)}
                  {u.extension ? ` · ${u.extension}` : ''} · {tabLabel(u.tab, tc)}
                  {u.connections > 1 ? ` · ${t('tabs', { n: u.connections })}` : ''}
                </span>
              </span>
              <span
                className={u.visible ? 'text-[11px] font-semibold text-positive' : 'text-[11px] text-muted-foreground'}
              >
                {t(u.visible ? 'active' : 'away')}
              </span>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
