import { experienceGroups, sharesBullets, type CvPosition } from '@cv/shared';
import { GroupLists, visibleGroups, type LineGroup } from './groups.js';
import type { Labels } from './labels.js';
import { dateRange, filled, periodOf } from './text.js';

export interface EntryProps {
  id: string;
  title: string;
  dates: string;
  org?: string;
  location?: string | undefined;
  compact?: boolean;
  /** Only the groups that have lines left (`visibleGroups`). */
  groups?: readonly LineGroup[];
  /** The line a PDF page that starts inside this job begins with (`paginate`); jobs only. */
  continued?: string | undefined;
}

/** An entry with none of these is not rendered at all. */
export const hasContent = (entry: EntryProps): boolean =>
  [entry.title, entry.dates, entry.org, entry.location].some(filled) ||
  (entry.groups ?? []).length > 0;

function Head({ title, dates }: { title: string; dates: string }) {
  return filled(title) || filled(dates) ? (
    <div className="cv-entry__head">
      {filled(title) ? <h3 className="cv-entry__title">{title}</h3> : null}
      {filled(dates) ? <span className="cv-entry__dates">{dates}</span> : null}
    </div>
  ) : null;
}

/** A position, an education entry or an extra entry: title with dates, the meta line, then its groups. */
export function Entry({
  title,
  dates,
  org,
  location,
  compact = false,
  groups = [],
  continued,
}: EntryProps) {
  return (
    <article
      className={compact ? 'cv-entry cv-entry--compact' : 'cv-entry'}
      data-continued={continued}
    >
      <Head title={title} dates={dates} />
      {filled(org) || filled(location) ? (
        <p className="cv-entry__meta">
          {filled(org) ? <span className="cv-entry__org">{org}</span> : null}
          {filled(location) ? <span className="cv-entry__location">{location}</span> : null}
        </p>
      ) : null}
      <GroupLists groups={groups} listClass="cv-entry__bullets" />
    </article>
  );
}

interface Role extends EntryProps {
  company: string;
  groups: readonly LineGroup[];
  start: string | null;
  end: string | null;
  current: boolean;
}

/**
 * Consecutive positions at one company (docs/specs/cv-template.md, behaviour 5a): the company once with
 * the block's overall period, then each title with its dates. Groups of a position follow it; when only
 * the first position has bullets, they are the company's shared bullets and follow the last title. The
 * text order is company, period, titles with dates, bullets.
 */
function GroupEntry({
  company,
  roles,
  labels,
}: {
  company: string;
  roles: readonly Role[];
  labels: Labels;
}) {
  const shared = sharesBullets(roles);
  // One location for the company only when every position gives that same one.
  const locations = [...new Set(roles.map((role) => role.location ?? ''))];
  const common = locations.length === 1 && filled(locations[0]) ? locations[0] : null;
  const period = periodOf(roles, labels);
  return (
    <article className="cv-entry cv-entry--group" data-continued={continuedLine(company, labels)}>
      <p className="cv-entry__meta">
        <span className="cv-entry__org">{company}</span>
        {common ? <span className="cv-entry__location">{common}</span> : null}
        {/* A modifier, not a plain `cv-entry__dates`: the period belongs to the company, not to one position. */}
        {filled(period) ? (
          <span className="cv-entry__dates cv-entry__dates--company">{period}</span>
        ) : null}
      </p>
      {roles.map((role) => (
        <div className="cv-entry__role" key={role.id}>
          <Head title={role.title} dates={role.dates} />
          {common === null && filled(role.location) ? (
            <p className="cv-entry__meta">
              <span className="cv-entry__location">{role.location}</span>
            </p>
          ) : null}
          {shared ? null : <GroupLists groups={role.groups} listClass="cv-entry__bullets" />}
        </div>
      ))}
      {shared ? <GroupLists groups={roles[0]?.groups ?? []} listClass="cv-entry__bullets" /> : null}
    </article>
  );
}

/** "Acme Corp — continued": the company, or the title of a job without one. */
const continuedLine = (name: string, labels: Labels) =>
  filled(name) ? `${name.trim()} ${labels.continued}` : undefined;

/** The entries of the experience section, one block per company; none when nothing has content. */
export function experienceEntries(experience: readonly CvPosition[], labels: Labels) {
  const roles: Role[] = experience
    .map((position) => ({
      id: position.id,
      title: position.title,
      dates: dateRange(position.start, position.end, position.current, labels),
      org: position.company,
      company: position.company,
      location: position.location,
      groups: visibleGroups(position.groups),
      start: position.start,
      end: position.end,
      current: position.current,
    }))
    .filter(hasContent);
  return experienceGroups(roles).flatMap((group) => {
    const [first] = group;
    if (!first) return [];
    return group.length === 1
      ? [
          <Entry
            key={first.id}
            {...first}
            continued={continuedLine(first.company || first.title, labels)}
          />,
        ]
      : [<GroupEntry key={first.id} company={first.company} roles={group} labels={labels} />];
  });
}
