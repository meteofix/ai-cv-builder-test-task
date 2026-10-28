import { setupServer } from 'msw/node';

/** Handlers are added per test with `server.use(...)`; an unhandled request fails the test. */
export const server = setupServer();
