/**
 * Copies text to the clipboard. Like legacy, falls back to `execCommand('copy')` where the
 * Clipboard API is missing (plain-HTTP LAN installs). The fallback textarea goes into `container`,
 * so it also works inside a modal that traps focus.
 */
export async function copyText(text: string, container?: HTMLElement | null): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or insecure context: try the fallback */
  }
  return execCommandCopy(text, container ?? document.body);
}

function execCommandCopy(text: string, container: HTMLElement): boolean {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  container.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  previous?.focus({ preventScroll: true });
  return ok;
}
