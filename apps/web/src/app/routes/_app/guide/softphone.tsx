import { createFileRoute } from '@tanstack/react-router';
import { SoftphoneGuidePage } from '@/pages/guide';
import { requirePermission } from '../../../lib/require-role';

/** 3CX softphone setup guide (legacy viewer modal). `guide.view`, like `/guide`. */
export const Route = createFileRoute('/_app/guide/softphone')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'guide.view'),
  component: SoftphoneGuidePage,
});
