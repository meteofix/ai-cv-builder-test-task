import '@testing-library/jest-dom/vitest';
import { File as NodeFile } from 'node:buffer';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setApiReachable } from '../api/connection';
import { server } from './server';
import { installMatchMedia } from './viewport';

// Node's fetch serialises only Node's own FormData and File, not the ones jsdom puts on the global object.
globalThis.File = NodeFile as unknown as typeof File;
// (A `Response` is the public way to reach Node's FormData class, which has no export of its own.)
globalThis.FormData = (await new Response(new URLSearchParams()).formData())
  .constructor as typeof FormData;

// Testing Library moves fake timers forward in `waitFor` and after every user-event step only when it finds a
// global `jest`; under Vitest it finds none and `await user.type()` hangs on a fake clock.
(globalThis as { jest?: unknown }).jest = {
  advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
};

// jsdom implements none of these; the components rely on them in every real browser.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
Element.prototype.scrollIntoView = () => undefined;
// Desktop by default; a test sets the phone layout with `setViewport('phone')`.
installMatchMedia();
globalThis.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

let inFlight = 0;
server.events.on('request:start', () => {
  inFlight += 1;
});
server.events.on('request:end', () => {
  inFlight -= 1;
});

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(async () => {
  cleanup();
  // Leaving a page sends what is still unsaved; let that request finish against this test's handlers, not the next one's.
  // A request needs a few ticks before MSW sees it start; a short wait first, then wait for what is in flight.
  await new Promise((resolve) => setTimeout(resolve, 25));
  for (const deadline = Date.now() + 2000; inFlight > 0 && Date.now() < deadline;) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  // Module state: a test that simulated an outage must not leave the banner for the next one.
  setApiReachable(true);
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
