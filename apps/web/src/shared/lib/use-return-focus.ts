import { useRef } from 'react';

/**
 * Radix puts focus back on a `Dialog.Trigger`; our dialogs open from code (no trigger), so on close focus fell to
 * <body> and keyboard users lost their place. Remember what had focus when the dialog opened and return to it
 * (WCAG 2.4.3). Spread the result onto `Dialog.Content`.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const el = document.activeElement;
      opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const el = opener.current;
      opener.current = null;
      if (el?.isConnected) {
        event.preventDefault();
        el.focus({ preventScroll: true });
      }
    },
  };
}
