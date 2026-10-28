import { act } from '@testing-library/react';
import { vi } from 'vitest';

let desktop = true;
const listeners = new Set<() => void>();

/** Which layout `matchMedia('(min-width: 1024px)')` reports. Set it before rendering, or later to simulate a resize. */
export function setViewport(kind: 'desktop' | 'phone'): void {
  desktop = kind === 'desktop';
  act(() => {
    listeners.forEach((listener) => {
      listener();
    });
  });
}

export function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
