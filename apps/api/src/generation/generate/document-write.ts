import type { EntityManager } from '@mikro-orm/postgresql';
import { Cv, type ICv } from '../../db/entities.js';
import { JobError } from '../job-errors.js';

/**
 * Compare-and-set on `version`; `updated_at` is set here because a native update skips MikroORM's
 * `onUpdate`. A conflict re-queues the job, which finalizes again from the stored step results.
 */
export async function replaceDocument(
  tx: EntityManager,
  cv: ICv,
  document: ICv['document'],
  now: Date,
): Promise<void> {
  const updated = await tx.nativeUpdate(
    Cv,
    { id: cv.id, version: cv.version },
    { document, version: cv.version + 1, updatedAt: now },
  );
  if (updated === 0) {
    throw new JobError('INTERNAL', 'The CV changed while it was being updated.', {
      retryable: true,
    });
  }
}
