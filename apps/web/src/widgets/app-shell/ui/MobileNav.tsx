import { Link, useLocation } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { cn } from '@/shared/lib/cn';
import { activeNavPath, visibleNavItems } from '../model/nav';

/**
 * Phones (below `md`) have no sidebar: the same pages as a strip under the header that scrolls sideways, groups
 * flattened (e.g. the «Sozlamalar» pages one after another). One item is highlighted, like in the sidebar.
 */
export function MobileNav() {
  const { t } = useTranslation();
  const user = useSessionUser();
  const pathname = useLocation({ select: (location) => location.pathname });
  const items = visibleNavItems(user);
  const active = activeNavPath(
    items.map((item) => item.to),
    pathname,
  );
  const ref = useRef<HTMLElement>(null);

  // A long strip (the superuser's): keep the current page in view.
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <nav ref={ref} className="flex gap-1 overflow-x-auto border-b px-2 py-1.5 md:hidden">
      {items.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: true, includeSearch: false }}
          activeProps={{}}
          aria-current={to === active ? 'page' : undefined}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground',
            to === active && 'bg-accent text-foreground',
          )}
        >
          <Icon className="size-4" />
          {t(label)}
        </Link>
      ))}
    </nav>
  );
}
