import { Link, useLocation } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { cn } from '@/shared/lib/cn';
import {
  type NavGroup,
  type NavItem,
  activeNavPath,
  isNavGroup,
  visibleNavEntries,
  visibleNavItems,
} from '../model/nav';

const ROW =
  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground';
const ACTIVE = 'bg-accent text-foreground';

/** The sidebar menu: plain links, plus groups (e.g. "Sozlamalar") that fold open and closed. */
export function SidebarNav() {
  const user = useSessionUser();
  const pathname = useLocation({ select: (location) => location.pathname });
  const entries = visibleNavEntries(user);
  const active = activeNavPath(
    visibleNavItems(user).map((item) => item.to),
    pathname,
  );

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
      {entries.map((entry) =>
        isNavGroup(entry) ? (
          <NavGroupSection key={entry.id} group={entry} active={active} />
        ) : (
          <NavLink key={entry.to} item={entry} active={entry.to === active} />
        ),
      )}
    </nav>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    // Highlight and aria-current come from `active` (one item per page), not the router's own prefix
    // match — that lights "/settings" on /settings/blacklist too. `exact` keeps the router from adding
    // aria-current to a parent item.
    <Link
      to={item.to}
      activeOptions={{ exact: true, includeSearch: false }}
      activeProps={{}}
      aria-current={active ? 'page' : undefined}
      className={cn(ROW, active && ACTIVE)}
    >
      <Icon className="size-4 shrink-0" />
      {t(item.label)}
    </Link>
  );
}

const storageKey = (id: string) => `cc.nav.${id}.open`;

function readOpen(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) === '1';
  } catch {
    return false;
  }
}

function saveOpen(id: string, open: boolean) {
  try {
    localStorage.setItem(storageKey(id), open ? '1' : '0');
  } catch {
    /* storage unavailable: the group just forgets its state */
  }
}

/** Opens on one of its pages, otherwise as the user last left it; the header only toggles. */
function NavGroupSection({ group, active }: { group: NavGroup; active: string | undefined }) {
  const { t } = useTranslation();
  const panelId = useId();
  const holdsActive = group.children.some((item) => item.to === active);
  const [open, setOpen] = useState(() => holdsActive || readOpen(group.id));

  // Arriving on one of its pages from elsewhere (a link, back/forward) unfolds the group.
  const [wasActive, setWasActive] = useState(holdsActive);
  if (holdsActive !== wasActive) {
    setWasActive(holdsActive);
    if (holdsActive) setOpen(true);
  }

  const toggle = () => {
    setOpen(!open);
    saveOpen(group.id, !open);
  };

  const Icon = group.icon;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className={cn(ROW, 'cursor-pointer', holdsActive && 'text-foreground', holdsActive && !open && ACTIVE)}
      >
        <Icon className="size-4 shrink-0" />
        {t(group.label)}
        <ChevronDown
          className={cn(
            'ml-auto size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
        />
      </button>
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
          <div className="mt-1 ml-5 flex flex-col gap-1 border-l border-border pl-2">
            {group.children.map((item) => (
              <NavLink key={item.to} item={item} active={item.to === active} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
