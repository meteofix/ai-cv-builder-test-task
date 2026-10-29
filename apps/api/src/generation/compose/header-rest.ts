import type { NotInCvItem } from '@cv/shared';
import { positionId, type DraftJob } from './draft.js';
import type { SegmentIndex } from './verbatim.js';

export const COMPANY_DESCRIPTION =
  'Company description or other job detail — no place for it in this CV';

// Fields of one line; a dash is not one of them: it joins the dates of a range ("Mar 2023 – present").
const PIECES = /\s*[|·•;]\s*/u;
const WORDS = /[\p{L}\p{N}]+/gu;
const LETTER = /\p{L}/u;
// Only counts ("2 years 11 months", "5 yrs 4 mos"): a duration the job's dates already show. Blind to
// the unit, so a field of counts alone ("300 clients") stays hidden too: a known limit.
const COUNTS = /^(?:\d+\s*\p{L}+[\s,]*)+$/u;
// Shorter words ("of", "and", "the") would tie almost any description to a title like "Head of Product".
const MIN_SHARED_CHARS = 4;

const words = (text: string) => text.toLowerCase().match(WORDS) ?? [];
const longWords = (text: string) => words(text).filter((word) => word.length >= MIN_SHARED_CHARS);

/** The years of a job's dates, as patterns that also find them written letter-spaced ("2 0 2 5"). */
function yearPatterns(job: DraftJob): RegExp[] {
  return [job.start, job.end]
    .flatMap((date) => (date ? [date.slice(0, 4)] : []))
    .map((year) => new RegExp(`(?<!\\d)${year.split('').join('\\s*')}(?!\\d)`, 'u'));
}

/**
 * What the CV shows of a line a job header cites: a part with one of its years, a word of four letters
 * or more from its title, company or location, only counts (a duration), or no letter. It errs towards
 * "shown": a description that shares such a word with the title stays hidden, as every description was
 * before, rather than a field of the header showing up in "Not in your CV". A title the author rewrote
 * from a conversational one ("Code wizard" → "Software Engineer") shares no word and is listed: a
 * known limit.
 */
function shownBy(jobs: readonly DraftJob[]): (part: string) => boolean {
  const fields = new Set(
    jobs.flatMap((job) => longWords(`${job.title} ${job.company} ${job.location}`)),
  );
  const years = jobs.flatMap(yearPatterns);
  return (part) =>
    !LETTER.test(part) ||
    COUNTS.test(part.trim()) ||
    years.some((year) => year.test(part)) ||
    words(part).some((word) => fields.has(word));
}

/**
 * The parts of a header line the CV does not show, in order: whole fields, and in a shown field its
 * round brackets that do not show (the innermost level only).
 */
function rest(text: string, shown: (part: string) => boolean): string[] {
  return text
    .split(PIECES)
    .filter((part) => part !== '')
    .flatMap((part) =>
      shown(part)
        ? [...part.matchAll(/\(([^()]*)\)/gu)]
            .map((match) => (match[1] ?? '').trim())
            .filter((inner) => inner && !shown(inner))
        : [part],
    );
}

/**
 * Lines that only job headers cite and that hold more than the header shows (a company description on
 * the dates line, "(promoted)"): the rest of each goes to "Not in your CV" with its reason, under its
 * first job, instead of counting as placed. Code compares text only; it never decides what the rest is.
 */
export function headerRests(
  experience: readonly DraftJob[],
  citedElsewhere: ReadonlySet<string>,
  index: SegmentIndex,
): NotInCvItem[] {
  // Each line with the jobs that cite it and the first of them, where "Add" puts it.
  const citing = new Map<string, { first: number; jobs: DraftJob[] }>();
  experience.forEach((job, i) => {
    job.segments
      .filter((id) => !citedElsewhere.has(id))
      .forEach((id) => {
        const known = citing.get(id);
        if (known) known.jobs.push(job);
        else citing.set(id, { first: i, jobs: [job] });
      });
  });
  return [...citing].flatMap(([id, { first, jobs }]): NotInCvItem[] => {
    const segment = index.get(id);
    if (!segment) return [];
    const parts = rest(segment.text, shownBy(jobs));
    return parts.length === 0
      ? []
      : [
          {
            text: parts.join(' · '),
            reason: 'not_included',
            context: COMPANY_DESCRIPTION,
            section: 'experience',
            itemId: positionId(first),
          },
        ];
  });
}
