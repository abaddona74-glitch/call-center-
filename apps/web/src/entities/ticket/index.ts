import './i18n';

export {
  addTicketComment,
  attachmentUrl,
  createTicket,
  fetchDocPreview,
  recordingUrl,
  ticketActions,
  ticketCallPrefillQuery,
  ticketContextQuery,
  ticketDirectories,
  ticketDirectoriesQuery,
  ticketExecutivesQuery,
  ticketKeys,
  ticketListQuery,
  ticketQuery,
  ticketReportQuery,
  ticketUnreadQuery,
} from './api/ticket.api';
export { STATUS_STRIPE, dateTime, fileSize, refName, timeAgo } from './lib/format';
export { OverdueBadge, RegionBadge, TicketStatusBadge, personName } from './ui/badges';
export { TicketMiniCard } from './ui/TicketMiniCard';
export { type ActionVariant, KdsAction, KdsField, KdsInput, KdsSelect, KdsTextarea } from './ui/kds-ui';
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
