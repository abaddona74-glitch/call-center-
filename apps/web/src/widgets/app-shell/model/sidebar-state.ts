import { useState } from 'react';

/**
 * Sidebar choices remembered per browser (localStorage, '1' / '0'). Storage can be off (private
 * window, blocked site data): reads then give `false` and saves do nothing — the sidebar just
 * forgets on reload.
 */
export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/** A nav group (e.g. "Sozlamalar") the user left open. */
export const navGroupKey = (id: string) => `cc.nav.${id}.open`;

const COLLAPSED_KEY = 'cc.nav.collapsed';

/** Whether the sidebar is folded to its icon rail; starts the way this browser last left it. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => readFlag(COLLAPSED_KEY));
  const toggle = () => {
    setCollapsed(!collapsed);
    saveFlag(COLLAPSED_KEY, !collapsed);
  };
  return { collapsed, toggle };
}
