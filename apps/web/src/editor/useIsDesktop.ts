import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 1024px)';

function subscribe(listener: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', listener);
  return () => {
    media.removeEventListener('change', listener);
  };
}

/** `lg` of the layout: from here the cards are open and the preview sits beside the form. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
}
