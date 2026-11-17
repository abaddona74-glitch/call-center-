import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Toast container (dark theme, matches the app). Use `toast()` from 'sonner' anywhere. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
