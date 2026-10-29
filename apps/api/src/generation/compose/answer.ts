import { LIMITS, type CvDocument } from '@cv/shared';
import { z } from 'zod';
import type { Segment } from '../../grounding/index.js';
import {
  alreadyShown,
  partGroups,
  partIndex,
  partKept,
  partLimits,
  partRewritten,
  partRoom,
  type Part,
  type PartItem,
} from './answer-part.js';
import { itemText } from './author-schema.js';
import type { ModelRequest, PreparedSource } from './compose.js';
import type { DraftItem } from './draft.js';
import { AUTHOR_PART_SYSTEM, currentMonth, defuse, REVIEWER_SYSTEM } from './prompts.js';
import {
  reviewOutputSchema,
  reviewSchema,
  type Place,
  type ReviewOutput,
  type ReviewTarget,
  type ReviewView,
} from './review.js';
import type { SegmentIndex } from './verbatim.js';

/**
 * The two model requests of a content answer (docs/specs/generation.md §5, decision 037): the author
 * rewrites the part, the reviewer checks the new items. The part itself is resolved in `answer-part.ts`.
 */

function answersBlock(answers: readonly Segment[]): string {
  const lines = answers
    .filter((segment) => !segment.instruction)
    .map((segment) => `${segment.id}: ${segment.text}`);
  return `<cv_answers>\n${defuse(lines.join('\n'))}\n</cv_answers>`;
}

/** What we asked and about which item: it helps read a short answer, but it is never evidence. */
function questionBlock(question: string, context: string | null): string {
  const lines = [`Question: ${question}`, ...(context ? [`About: ${context}`] : [])];
  return `<cv_question>\n${defuse(lines.join('\n'))}\n</cv_question>`;
}

function partLabel(document: CvDocument, part: Part): string {
  if (part.kind === 'summary') return 'The summary';
  const group = part.group === null ? null : partGroups(document, part)[part.group];
  const under = group?.title ? `, the subsection ${JSON.stringify(group.title)}` : '';
  if (part.section === 'experience') {
    const job = document.experience[part.job];
    return `The bullets of ${JSON.stringify([job?.title, job?.company].filter(Boolean).join(' — '))}${under}`;
  }
  const section = document.additional[part.index];
  const entry = section?.entries[part.entry];
  const name = entry?.title ? ` ${JSON.stringify(entry.title)}` : '';
  return `The lines of${name} in the section ${JSON.stringify(section?.title ?? '')}${under}`;
}

function partBlock(document: CvDocument, part: Part): string {
  const line = (item: PartItem, note: string) => `- ${JSON.stringify(item.text)} (${note})`;
  const lines = [
    ...partRewritten(document, part).map((item) => line(item, `from ${item.factIds.join(', ')}`)),
    ...partKept(document, part).map((item) => line(item, 'stays as it is')),
  ];
  if (lines.length === 0) lines.push('(nothing yet)');
  return `<cv_document>\n${defuse([`${partLabel(document, part)}:`, ...lines].join('\n'))}\n</cv_document>`;
}

export const partOutputSchema = z.object({
  items: z.array(
    z.object({
      text: z
        .string()
        .describe('"" keeps the cited segments word for word; otherwise the rewritten text'),
      segments: z.array(z.string()).describe('ids of the segments it rests on'),
    }),
  ),
});
export type PartOutput = z.infer<typeof partOutputSchema>;

/** Every cited id exists, an item cites one at least, and the items fit the part's limits. */
function partCheck(index: SegmentIndex, part: Part, room: number, kept: readonly PartItem[]) {
  const { chars } = partLimits(part);
  return (output: PartOutput): string | null => {
    const problems: string[] = [];
    if (output.items.length > room) problems.push(`At most ${room} items`);
    output.items.forEach((item, i) => {
      const unknown = item.segments.filter((id) => !index.has(id));
      if (unknown.length > 0)
        problems.push(`items.${i}: unknown segment ids ${unknown.join(', ')}`);
      if (item.segments.length === 0) problems.push(`items.${i}: cite at least one segment`);
      if (item.segments.length > LIMITS.maxFactIds) {
        problems.push(`items.${i}: cite at most ${LIMITS.maxFactIds} segments`);
      }
      if (itemText(item, index).length > chars) {
        problems.push(`items.${i}: longer than ${chars} characters`);
      }
    });
    const written = output.items.map((item) => ({
      text: itemText(item, index),
      factIds: item.segments,
    }));
    const summary = summaryProblem(part, [...kept, ...written]);
    if (summary) problems.push(summary);
    return problems.length > 0 ? problems.join('\n') : null;
  };
}

/** The summary is one text of the document: its sentences together must fit its limits. */
function summaryProblem(part: Part, items: readonly PartItem[]): string | null {
  if (part.kind !== 'summary') return null;
  if (items.map((item) => item.text).join(' ').length > LIMITS.maxSummaryChars) {
    return `The summary is longer than ${LIMITS.maxSummaryChars} characters`;
  }
  if (new Set(items.flatMap((item) => item.factIds)).size > LIMITS.maxFactIds) {
    return `The summary cites more than ${LIMITS.maxFactIds} segments`;
  }
  return null;
}

export interface PartInput {
  source: PreparedSource;
  answers: readonly Segment[];
  document: CvDocument;
  part: Part;
  targetRole: string;
  /** The job's clock: both prompts count years of experience up to its month. */
  now: Date;
}

export interface PartQuestion {
  question: string;
  context: string | null;
}

export function partRequest(input: PartInput & PartQuestion): ModelRequest<PartOutput> {
  const index = partIndex(input.source, input.answers);
  const room = partRoom(input.document, input.part);
  return {
    role: 'author',
    system: AUTHOR_PART_SYSTEM,
    cached: input.source.cached,
    input: [
      `<target_role>${defuse(input.targetRole)}</target_role>`,
      currentMonth(input.now),
      answersBlock(input.answers),
      questionBlock(input.question, input.context),
      partBlock(input.document, input.part),
      `The newest answer is ${input.answers.at(-1)?.id ?? 'A1'}. ${
        input.part.scope === 'item'
          ? 'Write only the one item the question is about; the items shown stay as they are.'
          : `Write the new version of the items marked with their segments, and what the answer adds: at most ${room} items.`
      }`,
    ].join('\n'),
    schema: partOutputSchema,
    check: partCheck(index, input.part, room, partKept(input.document, input.part)),
  };
}

function place(part: Part): Place {
  if (part.kind === 'summary') return { section: 'summary' };
  return part.section === 'experience'
    ? { section: 'experience', job: part.job }
    : { section: 'additional', index: part.index };
}

/** The new items as the reviewer reads them, ids `part.1…`. */
export function partView(output: PartOutput, index: SegmentIndex, part: Part): ReviewView {
  const targets = new Map<string, ReviewTarget>();
  const lines: string[] = [];
  output.items.forEach((authored, i) => {
    const item: DraftItem = {
      text: itemText(authored, index),
      segments: [...authored.segments],
      kept: authored.text.trim() === '',
    };
    const id = `part.${i + 1}`;
    targets.set(id, { kind: 'item', item, place: place(part), max: partLimits(part).chars });
    const how = item.kept ? 'unchanged, from' : 'rewritten, evidence';
    lines.push(`[${id}] (${how} ${item.segments.join(', ')}) ${JSON.stringify(item.text)}`);
  });
  return { targets, text: lines.join('\n') };
}

export function partReviewRequest(
  input: PartInput & PartQuestion & { output: PartOutput },
): ModelRequest<ReviewOutput> {
  const index = partIndex(input.source, input.answers);
  const view = partView(input.output, index, input.part);
  const refined = reviewSchema(view, index);
  return {
    role: 'reviewer',
    system: REVIEWER_SYSTEM,
    cached: input.source.cached,
    input: [
      `<target_role>${defuse(input.targetRole)}</target_role>`,
      currentMonth(input.now),
      answersBlock(input.answers),
      questionBlock(input.question, input.context),
      `<cv_document>\n${defuse(view.text)}\n</cv_document>`,
      'The answers are evidence like the source; the question and what it was about are not.',
    ].join('\n'),
    schema: reviewOutputSchema,
    check: (output) => {
      const result = refined.safeParse(output);
      if (!result.success) return z.prettifyError(result.error);
      // Applied as finalize will apply it: fixes may still take the summary past its limits.
      const shown = partRewritten(input.document, input.part);
      const { items } = reviewedItems(input.output, output, index, input.part, shown);
      return summaryProblem(input.part, [...partKept(input.document, input.part), ...items]);
    },
  };
}

/**
 * The reviewed items: a fix replaces the text and its evidence, an ask leaves the item out — except an
 * item kept word for word that the part already showed (`shown`, same segments): that is text the CV
 * held, and an ask cannot take it out. A kept line from elsewhere has no such protection.
 */
export function reviewedItems(
  output: PartOutput,
  review: ReviewOutput,
  index: SegmentIndex,
  part: Part,
  shown: readonly PartItem[],
): { items: PartItem[]; left: number } {
  const view = partView(output, index, part);
  const left = new Set<string>();
  const seen = new Set<string>();
  for (const issue of review.issues) {
    const target = view.targets.get(issue.item);
    if (target?.kind !== 'item' || seen.has(issue.item)) continue;
    seen.add(issue.item);
    if (issue.action === 'ask') {
      if (!(target.item.kept && alreadyShown(target.item.segments, shown))) left.add(issue.item);
    } else {
      Object.assign(target.item, {
        text: (issue.text ?? '').trim(),
        segments: [...issue.segments],
      });
    }
  }
  const items = [...view.targets.entries()].flatMap(([id, target]) =>
    target.kind === 'item' && !left.has(id)
      ? [{ text: target.item.text, factIds: [...target.item.segments] }]
      : [],
  );
  return { items, left: left.size };
}
