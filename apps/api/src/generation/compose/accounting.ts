import type { NotInCvItem, SourceCoverage } from '@cv/shared';
import type { Segment } from '../../grounding/index.js';
import type { Asked } from './apply-review.js';
import type { AuthorOutput } from './author-schema.js';
import { groupItems, positionId, type Draft } from './draft.js';
import { headerRests } from './header-rest.js';
import { verbatim, type SegmentIndex } from './verbatim.js';

/**
 * A segment the author calls a heading must be short (spaces not counted): a longer one counted as placed
 * could hide content that never reached the CV. A safeguard on length only, never on wording.
 */
export const MAX_HEADING_CHARS = 60;

/** Short enough to count as a heading; spaces do not count ("S U M M A R Y" is still short). */
export const isHeadingLength = (text: string) =>
  text.replace(/\s+/g, '').length <= MAX_HEADING_CHARS;

/**
 * Share of content segments nothing cites above which the editor warns that part of the CV may be lost
 * (decision 034).
 */
export const LOW_COVERAGE_SHARE = 0.25;

// A line of dates, a phone or a figure is content too; a lone bullet or a rule is not.
const HAS_CONTENT = /[\p{L}\p{N}]/u;

const UNCONFIRMED = 'Could not be confirmed from your CV';
const NOT_A_LINK = 'Not a web address, so it is not among your links';

/** Every segment the final draft cites, including items taken out for a question. */
export function draftCitations(draft: Draft): Set<string> {
  const cited = new Set<string>(draft.contactSegments);
  const add = (ids: readonly string[]) => {
    ids.forEach((id) => cited.add(id));
  };
  for (const item of [draft.fullName, draft.location, draft.headline, ...draft.summary]) {
    if (item) add(item.segments);
  }
  for (const job of draft.experience) {
    add(job.segments);
    groupItems(job.groups).forEach((bullet) => {
      add(bullet.segments);
    });
  }
  draft.education.forEach((entry) => {
    add(entry.segments);
  });
  draft.skills.forEach((group) => {
    add(group.segments);
  });
  draft.additional.forEach((section) => {
    section.entries.forEach((entry) => {
      add(entry.segments);
      groupItems(entry.groups).forEach((item) => {
        add(item.segments);
      });
    });
  });
  return cited;
}

/**
 * "Not in your CV" (decision 035): what the author left out with its reason, every content segment
 * nothing cites (word for word; usually none), and the instruction-like segments no model saw. Nothing
 * of the source disappears without showing here or in the CV.
 */
export function accountSource(input: {
  segments: readonly Segment[];
  index: SegmentIndex;
  author: AuthorOutput;
  draft: Draft;
  /** Findings of the reviewer that took an item out but did not fit among the questions. */
  unasked: readonly Asked[];
}): { items: NotInCvItem[]; coverage: SourceCoverage } {
  const { segments, index, author, draft } = input;
  const inDocument = draftCitations(draft);
  const notIncluded = author.notIncluded
    // Something the CV already shows needs no "Add".
    .filter((entry) => entry.segments.some((id) => !inDocument.has(id)))
    .map((entry): NotInCvItem => {
      const itemId =
        entry.section === 'experience' && entry.job > 0 ? positionId(entry.job - 1) : undefined;
      return {
        text: verbatim(
          entry.segments.filter((id) => !inDocument.has(id)),
          index,
        ),
        reason: 'not_included',
        context: entry.reason,
        section: entry.section,
        ...(itemId ? { itemId } : {}),
      };
    });

  const accounted = new Set(inDocument);
  author.notIncluded.forEach((entry) => {
    entry.segments.forEach((id) => accounted.add(id));
  });
  // What a job header cites but does not show; a line any other item of the CV cites is shown there.
  const besidesHeaders = draftCitations({
    ...draft,
    experience: draft.experience.map((job) => ({ ...job, segments: [] })),
  });
  const rests = headerRests(draft.experience, besidesHeaders, index);
  for (const id of author.headings) {
    const segment = index.get(id);
    if (segment && isHeadingLength(segment.text)) accounted.add(id);
  }
  const content = segments.filter(
    (segment) => !segment.instruction && HAS_CONTENT.test(segment.text),
  );
  const notPlaced = content
    .filter((segment) => !accounted.has(segment.id))
    .map((segment): NotInCvItem => ({ text: segment.text, reason: 'not_placed' }));
  const unconfirmed = input.unasked.map((item): NotInCvItem => ({
    text: item.original,
    reason: 'not_included',
    context: item.question ?? UNCONFIRMED,
    // "Add" puts a skill group back among the skills.
    ...(item.target.kind === 'skills' ? { section: 'skills' } : {}),
  }));
  // A handle the source writes ("Telegram: @name") is no link, but it is the person's contact.
  const notLinks = draft.notLinks.map((text): NotInCvItem => ({
    text,
    reason: 'not_included',
    context: NOT_A_LINK,
  }));
  const ignored = segments
    .filter((segment) => segment.instruction)
    .map((segment): NotInCvItem => ({ text: segment.text, reason: 'ignored' }));

  return {
    items: [...notIncluded, ...notLinks, ...unconfirmed, ...rests, ...notPlaced, ...ignored],
    coverage: {
      contentLines: content.length,
      notRecognized: notPlaced.length,
      low: content.length > 0 && notPlaced.length / content.length > LOW_COVERAGE_SHARE,
    },
  };
}
