import { ManagersDirectory, isManagersTab } from '@/widgets/managers-directory';

export interface ToolManagersPageProps {
  /** Initial tab from the URL (legacy `?tab=tashkent|ministry|regions|exat`); unknown values are ignored. */
  tab?: string;
  /** Initial search from the URL (legacy `?q=`). */
  q?: string;
}

/** "Mas'ul xodimlar" tool as a full page (legacy tools/managers.html). */
export function ToolManagersPage({ tab, q }: ToolManagersPageProps) {
  const initialTab = isManagersTab(tab) ? tab : undefined;
  // New URL params (another link to this page) start the directory over with them.
  return <ManagersDirectory key={`${initialTab ?? ''}|${q ?? ''}`} initialTab={initialTab} initialQuery={q} />;
}
