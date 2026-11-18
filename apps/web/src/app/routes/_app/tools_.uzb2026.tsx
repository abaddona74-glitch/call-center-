import { createFileRoute } from '@tanstack/react-router';
import { ToolUzb2026Page } from '@/pages/tool-uzb2026';
import { requirePermission } from '../../lib/require-role';

/** Legacy tools/uzb2026.html — the new Uzbek Latin keyboard (download + guide). */
export const Route = createFileRoute('/_app/tools_/uzb2026')({
  beforeLoad: ({ context }) => requirePermission(context.user, 'tools.view'),
  component: ToolUzb2026Page,
});
