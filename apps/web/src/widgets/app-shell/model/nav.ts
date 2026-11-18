import type { Permission } from '@cc/shared';
import { CDR_ACCESS } from '@cc/shared';
import {
  AudioLines,
  BookOpen,
  CalendarClock,
  ClipboardList,
  ChartColumn,
  Headset,
  History,
  LayoutDashboard,
  type LucideIcon,
  MapPinned,
  Settings,
  ShieldBan,
  Ticket,
  UserRound,
  Users,
} from 'lucide-react';

export interface NavItem {
  to: string;
  /** i18n key */
  label: string;
  icon: LucideIcon;
  /** The item shows when the user has any of these permissions. */
  permission?: Permission | Permission[];
}

/**
 * Sidebar navigation. Feature work adds one line per page here; the route itself
 * must still enforce the permission in `beforeLoad` (hiding a link is not a permission check).
 * Items without `permission` show for everyone signed in.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, permission: 'monitor.view' },
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
  {
    to: '/settings',
    label: 'nav.settings',
    icon: Settings,
    permission: ['users.manage', 'sessions.manage', 'security.manage', 'settings.manage', 'audit.view'],
  },
  { to: '/settings/blacklist', label: 'nav.blacklist', icon: ShieldBan, permission: 'blacklist.manage' },
  { to: '/settings/calendar', label: 'nav.callbackSettings', icon: CalendarClock, permission: 'settings.manage' },
  {
    to: '/settings/tickets',
    label: 'nav.ticketSettings',
    icon: MapPinned,
    permission: 'tickets.directories.manage',
  },
  { to: '/profile', label: 'nav.profile', icon: UserRound },
  // Operator guide: static content for every signed-in user (no permission, see routes/_app/guide)
  { to: '/guide', label: 'nav.guide', icon: BookOpen },
];
