import './i18n';

export {
  addTicketComment,
  attachmentUrl,
  cleanupTickets,
  createTicket,
  deleteTicket,
  fetchDocPreview,
  ticketContextQuery,
  ticketKeys,
  ticketListQuery,
  ticketQuery,
  transitionTicket,
  updateTicket,
} from './api/ticket.api';
export { fileSize, STATUS_STRIPE, timeAgo } from './lib/format';
export { personName, TicketStatusBadge, TicketTargetBadge, UrgentBadge } from './ui/badges';
export { TicketMiniCard } from './ui/TicketMiniCard';
export { type ActionVariant, KdsAction, KdsField, KdsInput, KdsSelect, KdsTextarea, UrgentToggle } from './ui/kds-ui';
export {
  AttachButton,
  Dropzone,
  Kbd,
  PreviewStrip,
  acceptFiles,
  clipboardImages,
  localKind,
  useClipboardRouter,
  usePasteTarget,
} from './ui/attachments/picker';
export { AttachmentGallery, DocViewer, type ViewerSource } from './ui/attachments/viewer';
