import { CDR_ACCESS, type Role } from '@cc/shared';
import {
  AudioLines,
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
  Users,
} from 'lucide-react';

export interface NavItem {
  to: string;
  /** i18n key */
  label: string;
  icon: LucideIcon;
  /** Minimum role that sees the item. */
  minRole: Role;
}

/**
 * Sidebar navigation. Feature work adds one line per page here; the route itself
 * must still enforce the role in `beforeLoad` (hiding a link is not a permission check).
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, minRole: 'operator' },
  { to: '/explorer', label: 'nav.explorer', icon: AudioLines, minRole: 'admin' },
  { to: '/tickets', label: 'nav.tickets', icon: Ticket, minRole: 'operator' },
  { to: '/tickets/reports', label: 'nav.ticketReports', icon: ClipboardList, minRole: 'admin' },
  { to: '/clients', label: 'nav.clients', icon: Users, minRole: 'operator' },
  { to: '/operators', label: 'nav.operators', icon: Headset, minRole: 'operator' },
  { to: '/history', label: 'nav.history', icon: History, minRole: CDR_ACCESS['history.page'] },
  { to: '/statistics', label: 'nav.statistics', icon: ChartColumn, minRole: CDR_ACCESS['stats.read'] },
  { to: '/settings', label: 'nav.settings', icon: Settings, minRole: 'admin' },
  { to: '/settings/blacklist', label: 'nav.blacklist', icon: ShieldBan, minRole: 'admin' },
  { to: '/settings/callbacks', label: 'nav.callbackSettings', icon: CalendarClock, minRole: 'admin' },
  { to: '/settings/tickets', label: 'nav.ticketSettings', icon: MapPinned, minRole: 'superuser' },
];
