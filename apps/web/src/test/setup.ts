import '@testing-library/jest-dom/vitest';
import { File as NodeFile } from 'node:buffer';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setApiReachable } from '../api/connection';
import { server } from './server';

// Node's fetch serialises only Node's own FormData and File, not the ones jsdom puts on the global object.
globalThis.File = NodeFile as unknown as typeof File;
// (A `Response` is the public way to reach Node's FormData class, which has no export of its own.)
globalThis.FormData = (await new Response(new URLSearchParams()).formData())
  .constructor as typeof FormData;

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
