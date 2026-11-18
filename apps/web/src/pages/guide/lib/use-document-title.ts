import { useEffect } from 'react';

/** Sets the tab title while the page is open (legacy: "Tizimlar va Rollar Daraxti | Call Center AI"). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} | Call Center`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
