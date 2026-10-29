import { Migration20261028211913_schema } from './Migration20261028211913_schema.js';
import { Migration20261029120000_skill_groups } from './Migration20261029120000_skill_groups.js';
import { Migration20261029140000_item_groups } from './Migration20261029140000_item_groups.js';

/** Listed explicitly so the tests (TypeScript sources), `dist` and the Docker image run the same migrations. */
export const MIGRATIONS = [
  Migration20261028211913_schema,
  Migration20261029120000_skill_groups,
  Migration20261029140000_item_groups,
];
