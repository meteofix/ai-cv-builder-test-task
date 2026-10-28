import { Migration20261028210959_schema } from './Migration20261028210959_schema.js';

/** Listed explicitly so the tests (TypeScript sources), `dist` and the Docker image run the same migrations. */
export const MIGRATIONS = [Migration20261028210959_schema];
