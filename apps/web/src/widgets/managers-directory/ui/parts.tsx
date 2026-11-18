import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui/icon';
import { formatDisplayPhone, highlightParts, telHref } from '../model/search';

/** Legacy `highlight()`: search matches wrapped in <mark>, rendered as React elements (no HTML strings). */
export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="md-mark">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** Legacy `renderPhonePill`: number without +998, `tel:` link, copy and call buttons. */
export function PhonePill({
  phone,
  office = false,
  onCopy,
}: {
  phone: string | null | undefined;
  office?: boolean;
  onCopy: (display: string) => void;
}) {
  const { t } = useTranslation('managersDirectory');
  if (!phone) return null;
  const display = formatDisplayPhone(phone);
  const href = telHref(phone);
  return (
    <div className={office ? 'md-phone office' : 'md-phone'}>
      <a href={href} className="md-phone-link" title={t('phone.call')}>
        {display}
      </a>
      <button
        type="button"
        className="md-phone-action"
        title={t('phone.copy')}
        aria-label={`${t('phone.copy')}: ${display}`}
        onClick={(e) => {
          e.stopPropagation();
          onCopy(display);
        }}
      >
        <Icon name="clipboard-text" className="size-[13px]" />
      </button>
      <a href={href} className="md-phone-action" title={t('phone.dial')} aria-label={`${t('phone.dial')}: ${display}`}>
        <Icon name="call" className="size-[13px]" />
      </a>
    </div>
  );
}

export function EmptyState() {
  const { t } = useTranslation('managersDirectory');
  return (
    <div className="md-empty">
      <span className="md-empty-icon" aria-hidden="true">
        📭
      </span>
      {t('empty')}
    </div>
  );
}

/** Envelope (legacy E-XAT tab and banner icon). */
export function EnvelopeIcon({ size, strokeWidth }: { size: number; strokeWidth: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 20.5H7C4 20.5 2 19 2 15.5V8.5C2 5 4 3.5 7 3.5H17C20 3.5 22 5 22 8.5V15.5C22 19 20 20.5 17 20.5Z" />
      <path d="M17 9L13.87 11.5C12.84 12.32 11.15 12.32 10.12 11.5L7 9" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
