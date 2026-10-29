import type { EntityManager } from '@mikro-orm/postgresql';
import { CvSource } from '../../db/entities.js';
import { sourceFactsSchema, type SourceFacts } from './schemas.js';

export interface LoadedSource {
  text: string;
  /** As stored: facts of the flow before v2, the analysis of a v2 generation, or null. */
  facts: unknown;
}

/** The source of a CV whose ownership the caller has checked (or the worker holds the job of). */
export async function loadSource(em: EntityManager, cvId: string): Promise<LoadedSource | null> {
  const source = await em.findOne(CvSource, { cv: cvId });
  if (!source) return null;
  return {
    text: source.text,
    // Read through a schema only where a step needs facts: dates and named fields need none (V2-Z3).
    facts: source.facts,
  };
}

/** The facts a content answer of the flow before v2 builds on; a v2 CV has none until V2-Z3. */
export function requiredFacts(facts: unknown): SourceFacts {
  return sourceFactsSchema.parse(facts);
}
