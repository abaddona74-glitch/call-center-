import { useSyncExternalStore } from 'react';
import { withPageTransition } from './page-transition';

/**
 * Color theme of the app: a class on <html> (`dark` | `light`) that switches the design tokens in
 * app/styles/index.css. Dark is the default (the legacy look). The choice is kept per browser in
 * localStorage and applied before the first paint by public/theme-init.js (same key, same classes).
 */
export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** localStorage key, also read by public/theme-init.js before the first paint. */
export const THEME_STORAGE_KEY = 'cc.theme';
const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  // Recolor in one step: without this every `transition: all` in the legacy CSS would fade colors one by one.
  root.classList.add('theme-switching');
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  for (const listener of listeners) listener();
}

/** Switches the theme with a short whole-page crossfade (see withPageTransition). */
export function setTheme(theme: Theme): void {
  if (theme === readTheme()) return;
  withPageTransition(() => applyTheme(theme));
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed the theme: follow it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) applyTheme(e.newValue === 'light' ? 'light' : 'dark');
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Current theme; re-renders when it changes (here or in another tab). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => 'dark');
}

/**
 * A mid-tone accent color (status, carrier …) for *text*: as is in the dark theme, darkened toward ink in the
 * light one so it stays readable on white (see --shade in app/styles/index.css). Backgrounds keep the raw color.
 */
export function accentText(color: string): string {
  return `color-mix(in oklab, ${color}, var(--ink) var(--shade))`;
}
