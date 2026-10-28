import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setApiReachable } from '../api/connection';
import { server } from './server';

// jsdom implements none of these; the components rely on them in every real browser.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
Element.prototype.scrollIntoView = () => undefined;
globalThis.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  cleanup();
  // Module state: a test that simulated an outage must not leave the banner for the next one.
  setApiReachable(true);
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
