import type * as React from 'react';

/** Inline icons copied from the legacy tools markup (viewer index.html), drawn with currentColor. */
const stroke = (size: number, width = 2) =>
  ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }) as const;

export function ExternalIcon() {
  return (
    <svg {...stroke(14, 2.5)}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function BookIcon({ size = 24 }: { size?: number }) {
  return (
    <svg {...stroke(size)}>
      <path d="M22 18.5V6C22 4.62 20.88 3.5 19.5 3.5H16C14.34 3.5 13 4.84 13 6.5V20.5C13 21.05 13.45 21.5 14 21.5H19.5C20.88 21.5 22 20.38 22 19V18.5Z" />
      <path d="M2 18.5V6C2 4.62 3.12 3.5 4.5 3.5H8C9.66 3.5 11 4.84 11 6.5V20.5C11 21.05 10.55 21.5 10 21.5H4.5C3.12 21.5 2 20.38 2 19V18.5Z" />
      <path d="M11 6.5C11 4.84 12.34 3.5 14 3.5" />
    </svg>
  );
}

export function TreeIcon() {
  return (
    <svg {...stroke(24)}>
      <rect x="9" y="2.5" width="6" height="5" rx="1.5" />
      <rect x="2.5" y="16.5" width="6" height="5" rx="1.5" />
      <rect x="15.5" y="16.5" width="6" height="5" rx="1.5" />
      <path d="M12 7.5v4.5M5.5 16.5V12h13v4.5" />
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg {...stroke(24, 1.8)}>
      <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" />
      <path d="M20.59 22C20.59 18.13 16.74 15 12 15C7.26 15 3.41 18.13 3.41 22" />
    </svg>
  );
}

export function ConvertIcon() {
  return (
    <svg {...stroke(24)}>
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

export function TelegramIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z" />
    </svg>
  );
}

export function DocumentIcon() {
  return (
    <svg {...stroke(24)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

export function KeyboardIcon() {
  return (
    <svg {...stroke(24)}>
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
      {[6, 10, 14, 18].map((x) => (
        <line key={`a${x}`} x1={x} y1="8" x2={x} y2="8.01" />
      ))}
      {[6, 10, 14, 18].map((x) => (
        <line key={`b${x}`} x1={x} y1="12" x2={x} y2="12.01" />
      ))}
      <line x1="7" y1="16" x2="17" y2="16" />
    </svg>
  );
}

/** Zone heading icons (legacy isax unlock / star / category). */
export function StarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(20, 1.6)} {...props}>
      <path d="M13.73 3.51L15.49 7.03C15.73 7.52 16.37 7.99 16.91 8.08L20.1 8.61C22.14 8.95 22.62 10.43 21.15 11.89L18.67 14.37C18.25 14.79 18.02 15.6 18.15 16.18L18.86 19.25C19.42 21.68 18.13 22.62 15.98 21.35L12.99 19.58C12.45 19.26 11.56 19.26 11.01 19.58L8.02 21.35C5.88 22.62 4.58 21.67 5.14 19.25L5.85 16.18C5.98 15.6 5.75 14.79 5.33 14.37L2.85 11.89C1.39 10.43 1.86 8.95 3.9 8.61L7.09 8.08C7.62 7.99 8.26 7.52 8.5 7.03L10.26 3.51C11.22 1.6 12.78 1.6 13.73 3.51Z" />
    </svg>
  );
}

export function CategoryIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(20, 1.6)} {...props}>
      <path d="M5 10H7C9 10 10 9 10 7V5C10 3 9 2 7 2H5C3 2 2 3 2 5V7C2 9 3 10 5 10Z" />
      <path d="M17 10H19C21 10 22 9 22 7V5C22 3 21 2 19 2H17C15 2 14 3 14 5V7C14 9 15 10 17 10Z" />
      <path d="M17 22H19C21 22 22 21 22 19V17C22 15 21 14 19 14H17C15 14 14 15 14 17V19C14 21 15 22 17 22Z" />
      <path d="M5 22H7C9 22 10 21 10 19V17C10 15 9 14 7 14H5C3 14 2 15 2 17V19C2 21 3 22 5 22Z" />
    </svg>
  );
}

export function DragHintIcon() {
  return (
    <svg {...stroke(14, 1.6)}>
      <path d="M3 9h18M3 15h18" />
    </svg>
  );
}

export function BoxAddIcon() {
  return (
    <svg {...stroke(28, 1.5)}>
      <path d="M3.17 7.44L12 12.55L20.77 7.47" />
      <path d="M12 21.61V12.54" />
      <path d="M21.61 12.83V9.17C21.61 7.79 20.62 6.11 19.41 5.44L14.07 2.48C12.93 1.84 11.07 1.84 9.93 2.48L4.59 5.44C3.38 6.11 2.39 7.79 2.39 9.17V14.83C2.39 16.21 3.38 17.89 4.59 18.56L9.93 21.52C10.5 21.84 11.25 22 12 22C12.75 22 13.5 21.84 14.07 21.52" />
      <path d="M19.2 21.4C20.97 21.4 22.4 19.97 22.4 18.2C22.4 16.43 20.97 15 19.2 15C17.43 15 16 16.43 16 18.2C16 19.97 17.43 21.4 19.2 21.4Z" />
      <path d="M20.69 18.23H17.71M19.2 16.77V19.76" />
    </svg>
  );
}
