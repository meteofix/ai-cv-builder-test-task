import type { EntityManager } from '@mikro-orm/postgresql';
import { CvSource, GenerationJob } from '../../db/entities.js';
import {
  judgeResultSchema,
  sourceFactsSchema,
  writeResultSchema,
  type RemovedItem,
  type SourceFacts,
} from './schemas.js';

export interface LoadedSource {
  text: string;
  /** Null until the extract step has stored them. */
  facts: SourceFacts | null;
}

/** The source of a CV whose ownership the caller has checked (or the worker holds the job of). */
export async function loadSource(em: EntityManager, cvId: string): Promise<LoadedSource | null> {
  const source = await em.findOne(CvSource, { cv: cvId });
  if (!source) return null;
  return {
    text: source.text,
    // Written only by the extract step through the same schema; a mismatch is a bug, not user input.
    facts: source.facts === null ? null : sourceFactsSchema.parse(source.facts),
  };
}

/** Prose the checks removed during the latest generation: for questions' context and "Not in your CV". */
export async function removedProse(em: EntityManager, cvId: string): Promise<RemovedItem[]> {
  const job = await em.findOne(
    GenerationJob,
    { cv: cvId, kind: 'generate' },
    { orderBy: { createdAt: 'desc', id: 'desc' } },
  );
  if (!job) return [];
  // A step that has not run yet has no result; a result that does not parse is a bug and surfaces.
  const write = job.state.write === undefined ? null : writeResultSchema.parse(job.state.write);
  const judge = job.state.judge === undefined ? null : judgeResultSchema.parse(job.state.judge);
  return [...(write?.removed ?? []), ...(judge?.removed ?? [])];
}
