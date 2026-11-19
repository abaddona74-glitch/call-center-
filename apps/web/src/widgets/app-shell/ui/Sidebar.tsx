import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';
import { useSidebarCollapsed } from '../model/sidebar-state';
import { SidebarNav } from './SidebarNav';

/** The left menu. Folds to an icon rail (names move into tooltips); each browser keeps its choice. */
export function Sidebar() {
  const { t } = useTranslation();
  const { collapsed, toggle } = useSidebarCollapsed();
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = t(collapsed ? 'nav.expand' : 'nav.collapse');

  return (
    // Pinned to the viewport: the page scrolls, the sidebar stays put. A menu taller than
    // the screen scrolls inside the nav instead. z-30: above page content (animating
    // operator cards, z-10 sticky headers), below overlays (z-40 dock/banner, z-50 dialogs).
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        'sticky top-0 z-30 flex h-svh shrink-0 flex-col self-start border-r bg-card',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <TooltipProvider>
        <div className={cn('flex items-center gap-2 py-3', collapsed ? 'justify-center px-3' : 'pr-3 pl-5')}>
          {!collapsed && <span className="min-w-0 flex-1 truncate text-lg font-semibold">{t('app.title')}</span>}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={toggleLabel}
                onClick={toggle}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <ToggleIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {toggleLabel}
            </TooltipContent>
          </Tooltip>
        </div>
        <SidebarNav collapsed={collapsed} />
      </TooltipProvider>
    </aside>
  );
}
