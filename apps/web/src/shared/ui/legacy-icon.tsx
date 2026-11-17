import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Inline icons copied from the legacy markup that the iconsax sprite does not contain
 * (feather/iconsax paths, 24×24 grid, currentColor). Use <Icon> for sprite icons.
 */
const PATHS = {
  'volume-high': (
    <>
      <path d="M2 10V14C2 16 3 17 5 17H6.43C6.8 17 7.17 17.11 7.49 17.3L10.41 19.13C12.93 20.71 15 19.56 15 16.59V7.41C15 4.43 12.93 3.29 10.41 4.87L7.49 6.7C7.17 6.89 6.8 7 6.43 7H5C3 7 2 8 2 10Z" />
      <path d="M18 8C19.83 9.83 19.83 14.17 18 16" />
      <path d="M20.5 5.5C23.5 8.5 23.5 15.5 20.5 18.5" />
    </>
  ),
  'volume-cross': (
    <>
      <path d="M2 10V14C2 16 3 17 5 17H6.43C6.8 17 7.17 17.11 7.49 17.3L10.41 19.13C12.93 20.71 15 19.56 15 16.59V7.41C15 4.43 12.93 3.29 10.41 4.87L7.49 6.7C7.17 6.89 6.8 7 6.43 7H5C3 7 2 8 2 10Z" />
      <path d="M18 10L22 14" />
      <path d="M22 10L18 14" />
    </>
  ),
  'speaker-on': (
    <>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </>
  ),
  'speaker-off': (
    <>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </>
  ),
  add: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  'info-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  'alert-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  'export-3': (
    <>
      <path d="M13 11L21.2 2.8" />
      <path d="M22 6.8V2H17.2" />
      <path d="M11 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22H15C20 22 22 20 22 15V13" />
    </>
  ),
  gallery: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>
  ),
  'document-upload': (
    <>
      <path d="M9 17V11L7 13" />
      <path d="M9 11L11 13" />
      <path d="M22 10V15C22 20 20 22 15 22H9C4 22 2 20 2 15V9C2 4 4 2 9 2H14" />
      <path d="M22 10H18C15 10 14 9 14 6V2L22 10Z" />
    </>
  ),
  'document-download': (
    <>
      <path d="M9 11V17L11 15" />
      <path d="M9 17L7 15" />
      <path d="M22 10V15C22 20 20 22 15 22H9C4 22 2 20 2 15V9C2 4 4 2 9 2H14" />
      <path d="M22 10H18C15 10 14 9 14 6V2L22 10Z" />
    </>
  ),
  'file-pdf': (
    <>
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" />
      <path d="M14 2V8H20" />
      <path d="M9 15V12H10.5C11.3 12 11.5 12.7 11.5 13.5C11.5 14.3 11.3 15 10.5 15H9Z" />
      <line x1="14" y1="12" x2="14" y2="17" />
    </>
  ),
  'file-word': (
    <>
      <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" />
      <path d="M14 2V8H20" />
      <path d="M7 13L8.5 17L10 13L11.5 17L13 13" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  people: (
    <>
      <path d="M18 19C18 16.79 16.21 15 14 15H10C7.79 15 6 16.79 6 19" />
      <circle cx="12" cy="7" r="4" />
      <path d="M22 19C22 17.08 20.67 15.48 18.89 15.08" />
      <circle cx="17.5" cy="8.5" r="2.5" />
    </>
  ),
  message: (
    <>
      <path d="M8.5 19H8C4 19 2 18 2 13V8C2 4 4 2 8 2H16C20 2 22 4 22 8V13C22 17 20 19 16 19H15.5C15.19 19 14.89 19.15 14.7 19.4L13.2 21.4C12.54 22.28 11.46 22.28 10.8 21.4L9.3 19.4C9.14 19.18 8.77 19 8.5 19Z" />
      <path d="M7 8H17" />
      <path d="M7 13H13" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  logout: (
    <>
      <path d="M8.9 7.56C9.21 3.96 11.06 2.49 15.11 2.49H15.24C19.71 2.49 21.5 4.28 21.5 8.75V15.27C21.5 19.74 19.71 21.53 15.24 21.53H15.11C11.09 21.53 9.24 20.08 8.91 16.54" />
      <path d="M15 12H3.62" />
      <path d="M5.85 8.65L2.5 12L5.85 15.35" />
    </>
  ),
  'chevron-left': <polyline points="15 18 9 12 15 6" />,
  'chevron-right': <polyline points="9 18 15 12 9 6" />,
  'chevron-up': <polyline points="18 15 12 9 6 15" />,
  'rotate-cw': (
    <>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </>
  ),
  'rotate-ccw': (
    <>
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </>
  ),
  'skip-back': (
    <>
      <polygon points="19 20 9 12 19 4 19 20" />
      <line x1="5" y1="19" x2="5" y2="5" />
    </>
  ),
  repeat: (
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7.5" />
      <path d="M11 5.5 C 13.2 5.8 15 7.5 15.3 9.7" strokeWidth="2.2" />
      <line x1="16.5" y1="16.5" x2="21.5" y2="21.5" strokeWidth="2.8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type LegacyIconName = keyof typeof PATHS;

export function LegacyIcon({
  name,
  className,
  strokeWidth = 1.5,
}: {
  name: LegacyIconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-4 shrink-0', className)}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Filled play/pause glyphs of the legacy Studio player. */
export function PlayGlyph({ paused, className }: { paused: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cn('size-[22px]', className)} aria-hidden="true">
      {paused ? (
        <polygon points="7 4 20 12 7 20 7 4" />
      ) : (
        <>
          <rect x="6" y="4" width="4" height="16" rx="1.5" />
          <rect x="14" y="4" width="4" height="16" rx="1.5" />
        </>
      )}
    </svg>
  );
}

/** Six-bar equalizer of the legacy "Audio Explorer" header. */
export function EqualizerGlyph({ className }: { className?: string }) {
  const bars: Array<[number, number, number]> = [
    [2, 8, 8],
    [5.8, 5, 14],
    [9.6, 7, 10],
    [13.4, 2.5, 19],
    [17.2, 5, 14],
    [21, 8, 8],
  ];
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cn('size-5', className)} aria-hidden="true">
      {bars.map(([x, y, h]) => (
        <rect key={x} x={x - 1.2} y={y} width="2.4" height={h} rx="1.2" />
      ))}
    </svg>
  );
}
