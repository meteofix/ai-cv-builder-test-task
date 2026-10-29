import { Migration } from '@mikro-orm/migrations';

/**
 * Bullets and extra lines come in groups since v2 (decision 036). A document saved before holds flat
 * lists: a position's bullets become one group without a title; an extra section's lines become entries
 * without a title or dates, each holding one such group of at most 20 lines (an entry's limit; a section
 * had up to 40) — so the CV looks as it did. Data only; a document already in the new shape is left as
 * it is.
 */
export class Migration20261029140000_item_groups extends Migration {
  override name = 'Migration20261029140000_item_groups';

  override up(): void | Promise<void> {
    this.addSql(`update "cvs" set "document" = jsonb_set("document", '{experience}', (
        select coalesce(jsonb_agg(case when jsonb_exists(p, 'bullets') then
            (p - 'bullets') || jsonb_build_object('groups', case
              when jsonb_array_length(p->'bullets') = 0 then '[]'::jsonb
              else jsonb_build_array(jsonb_build_object(
                'id', (p->>'id') || '-g1', 'title', null, 'items', p->'bullets')) end)
          else p end order by n), '[]'::jsonb)
        from jsonb_array_elements("document"->'experience') with ordinality as e(p, n)))
      where jsonb_typeof("document"->'experience') = 'array'
        and exists (select 1 from jsonb_array_elements("document"->'experience') as p(v)
                    where jsonb_exists(p.v, 'bullets'));`);
    this.addSql(`update "cvs" set "document" = jsonb_set("document", '{additional}', (
        select coalesce(jsonb_agg(case when jsonb_exists(s, 'items') then
            (s - 'items') || jsonb_build_object('entries', case
              when jsonb_array_length(s->'items') = 0 then '[]'::jsonb
              else (select jsonb_agg(jsonb_build_object(
                  'id', (s->>'id') || '-e' || (c.k + 1), 'title', '', 'start', null, 'end', null,
                  'groups', jsonb_build_array(jsonb_build_object(
                    'id', (s->>'id') || '-g' || (c.k + 1), 'title', null, 'items', c.items)))
                  order by c.k)
                from (select (i.n - 1) / 20 as k, jsonb_agg(i.item order by i.n) as items
                      from jsonb_array_elements(s->'items') with ordinality as i(item, n)
                      group by 1) as c) end)
          else s end order by n), '[]'::jsonb)
        from jsonb_array_elements("document"->'additional') with ordinality as a(s, n)))
      where jsonb_typeof("document"->'additional') = 'array'
        and exists (select 1 from jsonb_array_elements("document"->'additional') as s(v)
                    where jsonb_exists(s.v, 'items'));`);
  }

  /** Back to flat lists in order; titles of groups and entries, and entry dates, are lost. */
  override down(): void | Promise<void> {
    this.addSql(`update "cvs" set "document" = jsonb_set("document", '{experience}', (
        select coalesce(jsonb_agg(case when jsonb_exists(p, 'groups') then
            (p - 'groups') || jsonb_build_object('bullets', coalesce((
              select jsonb_agg(item order by g.n, i.n)
                from jsonb_array_elements(p->'groups') with ordinality as g(grp, n),
                     jsonb_array_elements(g.grp->'items') with ordinality as i(item, n)), '[]'::jsonb))
          else p end order by n), '[]'::jsonb)
        from jsonb_array_elements("document"->'experience') with ordinality as e(p, n)))
      where jsonb_typeof("document"->'experience') = 'array'
        and exists (select 1 from jsonb_array_elements("document"->'experience') as p(v)
                    where jsonb_exists(p.v, 'groups'));`);
    this.addSql(`update "cvs" set "document" = jsonb_set("document", '{additional}', (
        select coalesce(jsonb_agg(case when jsonb_exists(s, 'entries') then
            (s - 'entries') || jsonb_build_object('items', coalesce((
              select jsonb_agg(item order by e.n, g.n, i.n)
                from jsonb_array_elements(s->'entries') with ordinality as e(entry, n),
                     jsonb_array_elements(e.entry->'groups') with ordinality as g(grp, n),
                     jsonb_array_elements(g.grp->'items') with ordinality as i(item, n)), '[]'::jsonb))
          else s end order by n), '[]'::jsonb)
        from jsonb_array_elements("document"->'additional') with ordinality as a(s, n)))
      where jsonb_typeof("document"->'additional') = 'array'
        and exists (select 1 from jsonb_array_elements("document"->'additional') as s(v)
                    where jsonb_exists(s.v, 'entries'));`);
  }
}
