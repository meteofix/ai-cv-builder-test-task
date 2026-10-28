import { vi } from 'vitest';

let desktop = true;

/** Which layout `matchMedia('(min-width: 1024px)')` reports; set it before rendering. */
export function setViewport(kind: 'desktop' | 'phone'): void {
  desktop = kind === 'desktop';
}

export function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
