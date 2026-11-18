import { createFileRoute } from '@tanstack/react-router';
import { SoftphoneGuidePage } from '@/pages/guide';

/** 3CX softphone setup guide (legacy viewer modal). Every signed-in user, like `/guide`. */
export const Route = createFileRoute('/_app/guide/softphone')({
  component: SoftphoneGuidePage,
});
