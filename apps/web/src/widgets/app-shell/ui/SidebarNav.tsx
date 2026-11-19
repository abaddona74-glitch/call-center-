import { Link, useLocation } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { type ReactElement, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { cn } from '@/shared/lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import {
  type NavGroup,
  type NavItem,
  activeNavPath,
  isNavGroup,
  visibleNavEntries,
  visibleNavItems,
} from '../model/nav';
import { navGroupKey, readFlag, saveFlag } from '../model/sidebar-state';

const ROW =
  'relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground';
const ACTIVE = 'bg-accent text-foreground';

/**
 * The sidebar menu: plain links, plus groups (e.g. "Sozlamalar") that fold open and closed.
 * `collapsed` is the icon rail: labels stay for screen readers and show as tooltips on hover.
 */
export function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const user = useSessionUser();
  const pathname = useLocation({ select: (location) => location.pathname });
  const entries = visibleNavEntries(user);
  const active = activeNavPath(
    visibleNavItems(user).map((item) => item.to),
    pathname,
  );

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
      {entries.map((entry) =>
        isNavGroup(entry) ? (
          <NavGroupSection key={entry.id} group={entry} active={active} collapsed={collapsed} />
        ) : (
          <NavLink key={entry.to} item={entry} active={entry.to === active} collapsed={collapsed} />
        ),
      )}
    </nav>
  );
}

/** A row's text: on the rail it leaves the layout but stays the row's accessible name. */
function RowLabel({ text, collapsed }: { text: string; collapsed: boolean }) {
  return <span className={cn(collapsed && 'sr-only')}>{text}</span>;
}

/** On the rail a row is only an icon, so its name shows beside it on hover / focus. */
function RailTooltip({ label, collapsed, children }: { label: string; collapsed: boolean; children: ReactElement }) {
  if (!collapsed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(item.label);
  return (
    <RailTooltip label={label} collapsed={collapsed}>
      {/* Highlight and aria-current come from `active` (one item per page), not the router's own prefix
          match — that lights "/settings" on /settings/blacklist too. `exact` keeps the router from adding
          aria-current to a parent item. */}
      <Link
        to={item.to}
        activeOptions={{ exact: true, includeSearch: false }}
        activeProps={{}}
        aria-current={active ? 'page' : undefined}
        className={cn(ROW, active && ACTIVE)}
      >
        <Icon className="size-4 shrink-0" />
        <RowLabel text={label} collapsed={collapsed} />
      </Link>
    </RailTooltip>
  );
}

/** Opens on one of its pages, otherwise as the user last left it; the header only toggles. */
function NavGroupSection({
  group,
  active,
  collapsed,
}: {
  group: NavGroup;
  active: string | undefined;
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const holdsActive = group.children.some((item) => item.to === active);
  const [open, setOpen] = useState(() => holdsActive || readFlag(navGroupKey(group.id)));

  // Arriving on one of its pages from elsewhere (a link, back/forward) unfolds the group.
  const [wasActive, setWasActive] = useState(holdsActive);
  if (holdsActive !== wasActive) {
    setWasActive(holdsActive);
    if (holdsActive) setOpen(true);
  }

  const toggle = () => {
    setOpen(!open);
    saveFlag(navGroupKey(group.id), !open);
  };

  const Icon = group.icon;
  const label = t(group.label);
  return (
    <div className="flex flex-col">
      <RailTooltip label={label} collapsed={collapsed}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={cn(ROW, 'cursor-pointer', holdsActive && 'text-foreground', holdsActive && !open && ACTIVE)}
        >
          <Icon className="size-4 shrink-0" />
          <RowLabel text={label} collapsed={collapsed} />
          {/* On the rail the chevron shrinks into the icon's corner: it still says "this folds". */}
          <ChevronDown
            className={cn(
              'shrink-0 transition-transform duration-200 motion-reduce:transition-none',
              collapsed ? 'absolute right-0.5 size-3' : 'ml-auto size-4',
              !open && '-rotate-90',
            )}
          />
        </button>
      </RailTooltip>
      {/* 0fr ↔ 1fr animates the height; `inert` keeps folded links out of Tab order. */}
      <div
        id={panelId}
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {/* No room to indent on the rail: an outlined block marks the group's pages instead (an
              inset ring, so it takes no width and the overflow-hidden fold doesn't clip it). */}
          <div
            className={cn(
              'mt-1 flex flex-col gap-1',
              collapsed ? 'rounded-md bg-muted ring-1 ring-border ring-inset' : 'ml-5 border-l border-border pl-2',
            )}
          >
            {group.children.map((item) => (
              <NavLink key={item.to} item={item} active={item.to === active} collapsed={collapsed} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
