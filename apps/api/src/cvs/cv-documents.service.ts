import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { UpdateDocumentRequest, UpdateDocumentResponse } from '@cv/shared';
import { ApiError } from '../common/api-error.js';
import { GenerationQueue } from '../common/generation-queue.js';
import { OwnedCvs } from '../common/owned-cvs.js';
import { Cv } from '../db/entities.js';
import { lockCv } from './lock-cv.js';
import { assertNoNul } from './no-nul.js';
import { withServerProvenance } from './provenance.js';

/** Saving a hand-edited CV document with optimistic locking. */
@Injectable()
export class CvDocumentsService {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(OwnedCvs) private readonly owned: OwnedCvs,
    @Inject(GenerationQueue) private readonly queue: GenerationQueue,
  ) {}

  async save(
    id: string,
    userId: string,
    { document, version }: UpdateDocumentRequest,
  ): Promise<UpdateDocumentResponse> {
    assertNoNul(document, 'document');
    return this.em.fork().transactional(async (tx) => {
      // `findOwned` decides whose CV it is; the locked read below is the one the checks and the write use.
      const owned = await this.owned.findOwned(id, userId, tx);
      // Locked so that a job cannot be queued between the check below and the write: queuing inserts a row that
      // references this one and waits for the lock. A retry of a failed job only updates the job row and is not
      // covered; the worker re-reads the document when it finishes, so a save made at that moment is not lost.
      const cv = await lockCv(tx, owned.id, 'write');
      // The editor is read-only while the AI works on the CV; a save now would race its result.
      if (await this.queue.hasActiveJob(cv.id, tx)) throw new ApiError('JOB_ACTIVE');
      if (!cv.document) throw new ApiError('DOCUMENT_NOT_READY');
      // The stored document is what the provenance is computed from, so it must be the one the client saw.
      if (cv.version !== version) throw new ApiError('VERSION_CONFLICT');

      const stored = withServerProvenance(cv.document, document);
      // Compare-and-set on top of the lock, for writers that read the row before we locked it. A native update
      // skips the ORM's `onUpdate`, so the time is set here.
      const updated = await tx.nativeUpdate(
        Cv,
        { id: cv.id, version },
        { document: stored, version: version + 1, updatedAt: new Date() },
      );
      if (updated === 0) throw new ApiError('VERSION_CONFLICT');
      return { document: stored, version: version + 1 };
    });
  }
}
