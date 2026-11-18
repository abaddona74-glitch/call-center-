import type { ReactNode } from 'react';

/** Inline icons copied from the legacy guide markup (`guide.html`, the manual and 3CX modals). */
function Svg({ size, strokeWidth, children }: { size: number; strokeWidth: number; children: ReactNode }) {
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
      {children}
    </svg>
  );
}

export function ArrowLeftIcon() {
  return (
    <Svg size={15} strokeWidth={2.5}>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </Svg>
  );
}

export function HierarchyIcon({ size = 20, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <Svg size={size} strokeWidth={strokeWidth}>
      <path d="M12 6V2M12 22v-4M2 12h4M18 12h4" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="12" cy="20" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="20" cy="12" r="2" />
    </Svg>
  );
}

export function ResetIcon() {
  return (
    <Svg size={13} strokeWidth={2}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Svg>
  );
}

export function FitIcon() {
  return (
    <Svg size={15} strokeWidth={2}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </Svg>
  );
}

export function CloseIcon({ size = 17 }: { size?: number }) {
  return (
    <Svg size={size} strokeWidth={1.6}>
      <path d="M18 6L6 18" />
      <path d="M6 6L18 18" />
    </Svg>
  );
}

export function BookIcon() {
  return (
    <Svg size={24} strokeWidth={2}>
      <path d="M22 18.5V6C22 4.62 20.88 3.5 19.5 3.5H16C14.34 3.5 13 4.84 13 6.5V20.5C13 21.05 13.45 21.5 14 21.5H19.5C20.88 21.5 22 20.38 22 19V18.5Z" />
      <path d="M2 18.5V6C2 4.62 3.12 3.5 4.5 3.5H8C9.66 3.5 11 4.84 11 6.5V20.5C11 21.05 10.55 21.5 10 21.5H4.5C3.12 21.5 2 20.38 2 19V18.5Z" />
      <path d="M11 6.5C11 4.84 12.34 3.5 14 3.5" />
    </Svg>
  );
}

export function PhoneIcon() {
  return (
    <Svg size={22} strokeWidth={2}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </Svg>
  );
}

/** Tab icons of the operator manual (iconsax shapes from the legacy modal). */
export function CallIcon() {
  return (
    <Svg size={15} strokeWidth={1.8}>
      <path d="M21.97 18.33C21.97 18.69 21.89 19.06 21.72 19.42C21.55 19.78 21.33 20.12 21.04 20.44C20.55 20.98 20.01 21.37 19.4 21.62C18.8 21.87 18.15 22 17.45 22C16.43 22 15.34 21.76 14.19 21.27C13.04 20.78 11.89 20.12 10.75 19.28C9.6 18.44 8.51 17.48 7.47 16.41C6.44 15.34 5.51 14.22 4.7 13.04C3.9 11.87 3.26 10.7 2.78 9.53C2.31 8.36 2.07 7.26 2.07 6.22C2.07 5.54 2.2 4.89 2.44 4.29C2.69 3.69 3.06 3.14 3.57 2.64C4.22 2 4.95 1.68 5.76 1.68C6.07 1.68 6.38 1.75 6.66 1.89C6.95 2.03 7.21 2.23 7.42 2.51L9.46 5.39C9.66 5.66 9.8 5.91 9.9 6.14C10 6.36 10.05 6.57 10.05 6.76C10.05 7 9.97 7.24 9.82 7.48C9.67 7.72 9.45 7.97 9.17 8.24L8.45 8.98C8.34 9.09 8.29 9.22 8.29 9.38C8.29 9.46 8.31 9.54 8.34 9.62C8.38 9.7 8.42 9.77 8.45 9.83C8.82 10.5 9.32 11.23 9.95 12.02C10.58 12.81 11.27 13.58 12.02 14.33C12.77 15.08 13.54 15.77 14.33 16.4C15.12 17.03 15.85 17.53 16.52 17.9C16.58 17.93 16.65 17.97 16.73 18.01C16.81 18.04 16.89 18.06 16.98 18.06C17.15 18.06 17.29 18 17.41 17.88L18.12 17.18C18.4 16.89 18.66 16.67 18.9 16.52C19.15 16.36 19.39 16.28 19.63 16.28C19.82 16.28 20.03 16.33 20.26 16.43C20.49 16.53 20.74 16.68 21.02 16.88L21.94 17.54C22.23 17.75 22.44 17.99 22.56 18.26C22.67 18.53 22.73 18.8 22.73 19.07" />
    </Svg>
  );
}

export function RepeatIcon() {
  return (
    <Svg size={15} strokeWidth={1.8}>
      <path d="M3.5 12C3.5 7.31 7.31 3.5 12 3.5C16.69 3.5 20.5 7.31 20.5 12C20.5 16.69 16.69 20.5 12 20.5" />
      <path d="M17 12L20.5 15.5L24 12" />
    </Svg>
  );
}

export function DocumentIcon() {
  return (
    <Svg size={15} strokeWidth={1.8}>
      <path d="M22 10V15C22 20 20 22 15 22H9C4 22 2 20 2 15V9C2 4 4 2 9 2H14" />
      <path d="M22 10H18C15 10 14 9 14 6V2L22 10Z" />
      <path d="M7 13H13" />
      <path d="M7 17H11" />
    </Svg>
  );
}

export function TimerIcon() {
  return (
    <Svg size={15} strokeWidth={1.8}>
      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
      <path d="M12 6V12L16 14" />
    </Svg>
  );
}

/** The legacy "setting-2" path was broken (coordinates outside the box); this is the iconsax gear. */
export function SettingIcon() {
  return (
    <Svg size={15} strokeWidth={1.8}>
      <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" />
      <path d="M2 12.88V11.12C2 10.08 2.85 9.22 3.9 9.22C5.71 9.22 6.45 7.94 5.54 6.37C5.02 5.47 5.33 4.3 6.24 3.78L7.97 2.79C8.76 2.32 9.78 2.6 10.25 3.39L10.36 3.58C11.26 5.15 12.74 5.15 13.65 3.58L13.76 3.39C14.23 2.6 15.25 2.32 16.04 2.79L17.77 3.78C18.68 4.3 18.99 5.47 18.47 6.37C17.56 7.94 18.3 9.22 20.11 9.22C21.15 9.22 22.01 10.07 22.01 11.12V12.88C22.01 13.92 21.16 14.78 20.11 14.78C18.3 14.78 17.56 16.06 18.47 17.63C18.99 18.54 18.68 19.7 17.77 20.22L16.04 21.21C15.25 21.68 14.23 21.4 13.76 20.61L13.65 20.42C12.75 18.85 11.27 18.85 10.36 20.42L10.25 20.61C9.78 21.4 8.76 21.68 7.97 21.21L6.24 20.22C5.33 19.7 5.02 18.53 5.54 17.63C6.45 16.06 5.71 14.78 3.9 14.78C2.85 14.78 2 13.92 2 12.88Z" />
    </Svg>
  );
}
