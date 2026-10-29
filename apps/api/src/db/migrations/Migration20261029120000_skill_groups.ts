import { Migration } from '@mikro-orm/migrations';

/**
 * Skills come in groups since v2 (decision 035): a document saved before holds a flat list, which becomes
 * one group without a title. Data only; a grouped document, an empty list and a document without skills
 * are left as they are. `jsonb_exists` instead of the `?` operator, which a query with parameters would
 * take for a placeholder.
 */
export class Migration20261029120000_skill_groups extends Migration {
  override name = 'Migration20261029120000_skill_groups';

  override up(): void | Promise<void> {
    this.addSql(`update "cvs"
      set "document" = jsonb_set("document", '{skills}', jsonb_build_array(jsonb_build_object(
        'id', 'skills', 'title', null, 'items', "document"->'skills')))
      where jsonb_typeof("document"->'skills') = 'array'
        and jsonb_array_length("document"->'skills') > 0
        and jsonb_exists("document"->'skills'->0, 'name');`);
  }

  /** Back to one flat list in group order; the titles of the groups are lost. */
  override down(): void | Promise<void> {
    this.addSql(`update "cvs"
      set "document" = jsonb_set("document", '{skills}', coalesce((
        select jsonb_agg(skill order by g.n, s.n)
          from jsonb_array_elements("document"->'skills') with ordinality as g(grp, n),
               jsonb_array_elements(g.grp->'items') with ordinality as s(skill, n)), '[]'::jsonb))
      where jsonb_typeof("document"->'skills') = 'array'
        and jsonb_array_length("document"->'skills') > 0
        and jsonb_exists("document"->'skills'->0, 'items');`);
  }
}
