import type { CvAdditionalSection } from '@cv/shared';
import { Entry, hasContent } from './entries.js';
import { GroupLists, visibleGroups } from './groups.js';
import type { Labels } from './labels.js';
import { dateRange, filled } from './text.js';

/**
 * The entries of one extra section. An entry with a title or dates is an `article.cv-entry` like a
 * position (title, dates on the right, then its groups as bullets); one with lines only — what a flat
 * list of lines became — is the reference's plain `ul.cv-list`. An entry without lines (a
 * course, a certificate) is compact, so a run of them sits as tight as the education entries.
 */
export function additionalEntries(section: CvAdditionalSection, labels: Labels) {
  return section.entries
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      dates: dateRange(entry.start, entry.end, false, labels),
      groups: visibleGroups(entry.groups),
    }))
    .filter(hasContent)
    .map((entry) =>
      filled(entry.title) || filled(entry.dates) ? (
        <Entry key={entry.id} {...entry} compact={entry.groups.length === 0} />
      ) : (
        <GroupLists key={entry.id} groups={entry.groups} listClass="cv-list" />
      ),
    );
}
