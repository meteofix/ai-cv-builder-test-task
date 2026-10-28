import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ApiError } from '../common/api-error.js';
import { Cv, type ICv } from '../db/entities.js';

/**
 * Locks the CV row for the rest of the transaction and reads it again. Every transaction in this module takes
 * this lock before any other row (questions, jobs), so two of them never wait for each other in a circle; a
 * `DELETE` of the CV, which locks the CV first and then its questions, takes part in the same order. `write`
 * keeps everyone else out, `read` lets other readers in but blocks a save or a delete. Call it after
 * `findOwned`, which decides whose CV it is; a CV deleted in between is a plain 404.
 */
export async function lockCv(
  tx: EntityManager,
  cvId: string,
  mode: 'read' | 'write',
): Promise<ICv> {
  const cv = await tx.findOne(
    Cv,
    { id: cvId },
    {
      lockMode: mode === 'write' ? LockMode.PESSIMISTIC_WRITE : LockMode.PESSIMISTIC_READ,
      refresh: true,
    },
  );
  if (!cv) throw new ApiError('CV_NOT_FOUND');
  return cv;
}
