import type { Permission, SessionUser } from '@cc/shared';
import { CDR_ACCESS, hasPermission } from '@cc/shared';
import {
  AudioLines,
  BookOpen,
  CalendarClock,
  Activity,
  ClipboardList,
  ChartColumn,
  Headset,
  History,
  LayoutDashboard,
  type LucideIcon,
  Map as MapIcon,
  MapPinned,
  Settings,
  Sparkles,
  ShieldBan,
  SlidersHorizontal,
  Ticket,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react';

export interface NavItem {
  to: string;
  /** i18n key */
  label: string;
  icon: LucideIcon;
  /** The item shows when the user has any of these permissions. */
  permission?: Permission | Permission[];
}

/** A collapsible sidebar section (e.g. "Sozlamalar"); its header only opens and closes it. */
export interface NavGroup {
  /** Stable id: the open/closed state is remembered under it. */
  id: string;
  /** i18n key */
  label: string;
  icon: LucideIcon;
  children: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export const isNavGroup = (entry: NavEntry): entry is NavGroup => 'children' in entry;

/**
 * Sidebar navigation. Feature work adds one line per page here; the route itself
 * must still enforce the permission in `beforeLoad` (hiding a link is not a permission check).
 * Items without `permission` show for everyone signed in.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, permission: 'monitor.view' },
  // Live situation board: observers land here (first item → `homePath`), the superuser too (owner, 19.11.2026)
  { to: '/situation', label: 'nav.situation', icon: Activity, permission: 'situation.view' },
  // Overview dashboard: observers' only page, the superuser too (owner, 19.11.2026)
  { to: '/overview', label: 'nav.overview', icon: MapIcon, permission: 'overview.view' },
  { to: '/explorer', label: 'nav.explorer', icon: AudioLines, permission: 'recordings.listen' },
  {
    to: '/tickets',
    label: 'nav.tickets',
    icon: Ticket,
    permission: ['tickets.create', 'tickets.callback', 'tickets.process', 'tickets.viewAll'],
  },
  // Ticket reports: whoever sees tickets beyond their own (ticket-access.ts `reports`)
  {
    to: '/tickets/reports',
    label: 'nav.ticketReports',
    icon: ClipboardList,
    permission: ['tickets.process', 'tickets.viewAll'],
  },
  { to: '/clients', label: 'nav.clients', icon: Users, permission: 'contacts.view' },
  { to: '/operators', label: 'nav.operators', icon: Headset, permission: 'monitor.view' },
  { to: '/history', label: 'nav.history', icon: History, permission: CDR_ACCESS['history.page'] },
  { to: '/statistics', label: 'nav.statistics', icon: ChartColumn, permission: CDR_ACCESS['stats.read'] },
  { to: '/analysis', label: 'nav.analysis', icon: Sparkles, permission: CDR_ACCESS['analysis.stats'] },
  {
    id: 'settings',
    label: 'nav.settings',
    icon: Settings,
    children: [
      {
        to: '/settings',
        label: 'nav.systemSettings',
        icon: SlidersHorizontal,
        permission: ['users.manage', 'sessions.manage', 'security.manage', 'settings.manage', 'audit.view'],
      },
      { to: '/settings/blacklist', label: 'nav.blacklist', icon: ShieldBan, permission: 'blacklist.manage' },
      {
        to: '/settings/calendar',
        label: 'nav.callbackSettings',
        icon: CalendarClock,
        permission: 'settings.manage',
      },
      {
        to: '/settings/tickets',
        label: 'nav.ticketSettings',
        icon: MapPinned,
        permission: 'tickets.directories.manage',
      },
    ],
  },
  { to: '/tools', label: 'nav.tools', icon: Wrench, permission: 'tools.view' },
  { to: '/profile', label: 'nav.profile', icon: UserRound },
  // Operator guide: static content, no server check to mirror (see routes/_app/guide)
  { to: '/guide', label: 'nav.guide', icon: BookOpen, permission: 'guide.view' },
];

const canSee = (user: SessionUser, item: NavItem) =>
  !item.permission || [item.permission].flat().some((p) => hasPermission(user, p));

/**
 * The sidebar as this user sees it: hidden items dropped, a group with no visible item dropped,
 * and a group left with one item shown as that item (nothing to fold).
 */
export function visibleNavEntries(user: SessionUser): NavEntry[] {
  return NAV_ENTRIES.flatMap((entry): NavEntry[] => {
    if (!isNavGroup(entry)) return canSee(user, entry) ? [entry] : [];
    const children = entry.children.filter((item) => canSee(user, item));
    return children.length > 1 ? [{ ...entry, children }] : children;
  });
}

/** The pages this user may open, groups flattened, in sidebar order. */
export function visibleNavItems(user: SessionUser): NavItem[] {
  return visibleNavEntries(user).flatMap((entry) => (isNavGroup(entry) ? entry.children : [entry]));
}

/**
 * The one sidebar item to highlight on `pathname`: the longest `to` that is the page itself or a
 * parent of it ('/' only for itself) — /settings/blacklist lights "Qora ro'yxat" alone, not "/settings" too.
 */
export function activeNavPath(paths: readonly string[], pathname: string): string | undefined {
  let best: string | undefined;
  for (const to of paths) {
    const hit = pathname === to || (to !== '/' && pathname.startsWith(`${to}/`));
    if (hit && (best === undefined || to.length > best.length)) best = to;
  }
  return best;
}

/** Where `/` sends a user without the dashboard (e.g. "Mas'ul" → tickets): the first page of their sidebar. */
export function homePath(user: SessionUser): string {
  return visibleNavItems(user).find((item) => item.to !== '/')?.to ?? '/profile';
}
