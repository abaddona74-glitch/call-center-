import { z } from 'zod';

/** Tabs of the operator manual, in the legacy order. `tree` is the default (no `?tab=` in the URL). */
export const MANUAL_TABS = ['tree', 'rules', 'transfer', 'telegram', 'schedule', 'troubleshoot'] as const;
export type ManualTab = (typeof MANUAL_TABS)[number];

/** URL search params of /guide/manual. An unknown tab falls back to the default instead of failing. */
export const manualSearchSchema = z.object({
  tab: z.enum(MANUAL_TABS).optional().catch(undefined),
});
export type ManualSearch = z.infer<typeof manualSearchSchema>;
