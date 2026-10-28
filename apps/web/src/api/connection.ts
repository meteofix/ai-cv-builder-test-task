import { useSyncExternalStore } from 'react';

/** Whether the last request got an answer from the API; the browser's own online flag is read separately. */
let reachable = true;
const listeners = new Set<() => void>();

export function setApiReachable(value: boolean): void {
  if (reachable === value) return;
  reachable = value;
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** True while the browser is offline or the last request could not reach the API. */
export function useConnectionLost(): boolean {
  return useSyncExternalStore(subscribe, () => !reachable || !navigator.onLine);
}
