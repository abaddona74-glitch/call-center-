import { createFileRoute } from '@tanstack/react-router';
import { SoftphoneGuidePage } from '@/pages/guide';
import { requirePermission } from '../../../lib/require-role';

/** 3CX softphone setup guide (legacy viewer modal). Call-center staff, like `/guide`. */
export const Route = createFileRoute('/_app/guide/softphone')({
  // Call-center staff only: observers see just the overview dashboard (owner, 19.11.2026).
  beforeLoad: ({ context }) => requirePermission(context.user, 'monitor.view'),
  component: SoftphoneGuidePage,
});
