import { Dialog as DialogPrimitive } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui/icon';
import { Modal } from '@/shared/ui/modal';
import { ManagersDirectory } from '@/widgets/managers-directory';
import { UzbKeyboardGuide } from '@/widgets/uzb-keyboard-guide';

/** What "Shu yerda ochish" shows: one of our tools, or an external site that allows framing. */
export type ToolView = { kind: 'managers' } | { kind: 'uzb2026' } | { kind: 'iframe'; url: string; titleKey: string };

const PAGE_OF = { managers: '/tools/managers', uzb2026: '/tools/uzb2026' } as const;
const TITLE_OF = { managers: 'card.managers.title', uzb2026: 'card.uzb2026.title' } as const;

/** Legacy #toolIframeModal (screenshot viewer-06): big glass modal, title, "open in a new window", close. */
export function ToolModal({ view, onClose }: { view: ToolView | null; onClose: () => void }) {
  const { t } = useTranslation('tools');
  const href = view ? (view.kind === 'iframe' ? view.url : PAGE_OF[view.kind]) : '#';
  const title = view ? t(view.kind === 'iframe' ? view.titleKey : TITLE_OF[view.kind]) : '';

  return (
    <Modal
      open={view !== null}
      onOpenChange={(open) => !open && onClose()}
      glow="indigo"
      className="flex h-[90vh] w-[96vw] max-w-[1750px] flex-col overflow-hidden rounded-2xl border-chart-6/30 bg-sidebar p-0"
    >
      <div className="tl-modal-head">
        <DialogPrimitive.Title className="tl-modal-title">
          <span aria-hidden>🛠️</span>
          {title}
        </DialogPrimitive.Title>
        <div className="flex flex-wrap items-center gap-2">
          <a className="tl-btn secondary px-3 py-[5px]" href={href} target="_blank" rel="noopener noreferrer">
            {t('newWindow')}
          </a>
          <DialogPrimitive.Close className="tl-modal-close" aria-label={t('close')}>
            <Icon name="close" className="size-4" />
          </DialogPrimitive.Close>
        </div>
      </div>
      <div className="tl-modal-body">
        {view?.kind === 'iframe' && (
          <iframe
            src={view.url}
            title={title}
            // An external site: no access to our page, our cookies or top-level navigation.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write"
          />
        )}
        {view?.kind === 'managers' && (
          <div className="p-5">
            <ManagersDirectory />
          </div>
        )}
        {view?.kind === 'uzb2026' && (
          <div className="p-5">
            <UzbKeyboardGuide />
          </div>
        )}
      </div>
    </Modal>
  );
}
