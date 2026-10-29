import {
  cvDocumentSchema,
  localeSchema,
  notInCvItemSchema,
  sourceCoverageSchema,
  type CvDocument,
} from '@cv/shared';
import { z } from 'zod';
import { segmentSource, type Segment } from '../../grounding/index.js';
import type { LlmOutputMode, LlmRole } from '../../llm/llm-transport.js';
import { accountSource } from './accounting.js';
import { applyReview } from './apply-review.js';
import { authorSchema } from './author-checks.js';
import { authorOutputSchema, type AuthorOutput } from './author-schema.js';
import { additionalId, buildDraft, groupItems, toDocument, type Draft } from './draft.js';
import { alignStops } from './stops.js';
import {
  AUTHOR_SYSTEM,
  authorInput,
  REVIEWER_SYSTEM,
  reviewerInput,
  sourceBlock,
} from './prompts.js';
import { buildQuestions, type NewQuestion } from './questions.js';
import { reviewOutputSchema, reviewSchema, reviewView, type ReviewOutput } from './review.js';
import { indexSegments, type SegmentIndex } from './verbatim.js';

/**
 * A generation as pure steps (decision 035): segments → author → review → document, questions and
 * "Not in your CV". The job runs them one step at a time; the eval runs them in a row.
 */

export interface PreparedSource {
  text: string;
  segments: Segment[];
  /** The segments a model sees and may cite: instruction-like ones are cut before any model. */
  index: SegmentIndex;
  cached: string;
}

export function prepareSource(text: string): PreparedSource {
  const segments = segmentSource(text);
  const visible = segments.filter((segment) => !segment.instruction);
  return { text, segments, index: indexSegments(visible), cached: sourceBlock(segments) };
}

export interface ModelRequest<T> {
  role: LlmRole;
  system: string;
  cached: string;
  input: string;
  schema: z.ZodType<T>;
  check: (output: T) => string | null;
  output?: LlmOutputMode;
}

/** A refined schema as a check: its issues as one message for the re-ask, or null. */
function checkWith<T>(refined: z.ZodType<T>): (output: T) => string | null {
  return (output) => {
    const result = refined.safeParse(output);
    return result.success ? null : z.prettifyError(result.error);
  };
}

/**
 * The CV an answer leads to must pass the document schema here: finalize runs from the stored answers
 * and cannot ask again, so a document it could not save would fail the job on every retry.
 */
function documentProblem(draft: Draft): string | null {
  const result = cvDocumentSchema.safeParse(toDocument(draft));
  return result.success
    ? null
    : `The CV this answer makes does not fit its limits: ${z.prettifyError(result.error)}`;
}

/** `now` is the job's clock: years of experience are counted up to its month. */
export function authorRequest(
  source: PreparedSource,
  targetRole: string,
  now: Date,
): ModelRequest<AuthorOutput> {
  const answer = checkWith(authorSchema(source.index));
  return {
    role: 'author',
    // Too large for the service's grammar with groups and entries (decision 036).
    output: 'tool',
    system: AUTHOR_SYSTEM,
    cached: source.cached,
    input: authorInput(targetRole, now),
    schema: authorOutputSchema,
    check: (output) =>
      answer(output) ?? documentProblem(buildDraft(output, source.index, source.text, targetRole)),
  };
}

export function reviewRequest(
  source: PreparedSource,
  author: AuthorOutput,
  targetRole: string,
  now: Date,
): ModelRequest<ReviewOutput> {
  const draft = () => buildDraft(author, source.index, source.text, targetRole);
  const view = reviewView(draft());
  const answer = checkWith(reviewSchema(view, source.index));
  return {
    role: 'reviewer',
    system: REVIEWER_SYSTEM,
    cached: source.cached,
    input: reviewerInput(targetRole, view.text, now),
    schema: reviewOutputSchema,
    check: (output) => {
      const problem = answer(output);
      if (problem !== null) return problem;
      // Applied to a fresh draft, as finalize will apply it.
      const reviewed = draft();
      applyReview(reviewed, output, reviewView(reviewed), targetRole);
      return documentProblem(reviewed);
    },
  };
}

/** `cv_sources.facts` of a v2 generation: what the editor shows next to the document. */
export const sourceAnalysisSchema = z.object({
  version: z.literal(2),
  locale: localeSchema,
  notInCv: z.array(notInCvItemSchema),
  coverage: sourceCoverageSchema,
  orderReason: z.string().nullable(),
  /** The person's content answers in order: segments A1… of later answers (docs/specs/generation.md §5). */
  answers: z.array(z.string()).default([]),
});
export type SourceAnalysis = z.infer<typeof sourceAnalysisSchema>;

export interface Composed {
  document: CvDocument;
  questions: NewQuestion[];
  analysis: SourceAnalysis;
  /** For the log: how many items the review fixed and asked about. */
  counts: { fixed: number; asked: number; kept: number; rewritten: number };
}

/** Everything the finished generation stores, from the two stored model answers. */
export function compose(
  source: PreparedSource,
  author: AuthorOutput,
  review: ReviewOutput,
  targetRole: string,
): Composed {
  const draft = buildDraft(author, source.index, source.text, targetRole);
  const items = [
    ...draft.summary,
    ...draft.experience.flatMap((job) => groupItems(job.groups)),
    ...draft.additional.flatMap((section) =>
      section.entries.flatMap((entry) => groupItems(entry.groups)),
    ),
  ];
  const kept = items.filter((item) => item.kept).length;
  const view = reviewView(draft);
  const asked = applyReview(draft, review, view, targetRole);
  const { questions, unasked } = buildQuestions(draft, asked, author.gaps);
  // An entry the review emptied stays while a question about it (its title, dates or a line) waits for
  // the answer, so the answer has a place to go; one whose question fell past the cap has none.
  draft.additional.forEach((section, i) => {
    section.entries.forEach((entry, j) => {
      const id = `${additionalId(i)}-e${j + 1}`;
      entry.asked = questions.some(
        ({ target }) =>
          target.section === 'additional' &&
          (target.itemId === id || target.itemId?.startsWith(`${id}-`) === true),
      );
    });
  });
  const { items: notInCv, coverage } = accountSource({
    segments: source.segments,
    index: source.index,
    author,
    draft,
    unasked,
  });
  return {
    document: alignStops(toDocument(draft)),
    questions,
    analysis: {
      version: 2,
      locale: draft.locale,
      notInCv,
      coverage,
      orderReason: author.orderReason,
      answers: [],
    },
    counts: {
      fixed: review.issues.filter((issue) => issue.action === 'fix').length,
      asked: asked.length,
      kept,
      rewritten: items.length - kept,
    },
  };
}
