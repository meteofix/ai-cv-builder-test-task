import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { UpdateDocumentRequest, UpdateDocumentResponse } from '@cv/shared';
import { ApiError } from '../common/api-error.js';
import { GenerationQueue } from '../common/generation-queue.js';
import { OwnedCvs } from '../common/owned-cvs.js';
import { Cv } from '../db/entities.js';
import { assertNoNulInJson } from './no-nul.js';
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
    const em = this.em.fork();
    assertNoNulInJson(document, 'document');
    const cv = await this.owned.findOwned(id, userId, em);
    // The editor is read-only while the AI works on the CV; a save now would race its result.
    if (await this.queue.hasActiveJob(cv.id, em)) throw new ApiError('JOB_ACTIVE');
    if (!cv.document) throw new ApiError('DOCUMENT_NOT_READY');
    // The stored document is what the provenance is computed from, so it must be the one the client saw.
    if (cv.version !== version) throw new ApiError('VERSION_CONFLICT');

    const stored = withServerProvenance(cv.document, document);
    // Compare-and-set: of two saves of one version only one updates a row. A native update skips the ORM's
    // `onUpdate`, so the time is set here.
    const updated = await em.nativeUpdate(
      Cv,
      { id: cv.id, version },
      { document: stored, version: version + 1, updatedAt: new Date() },
    );
    if (updated === 0) throw new ApiError('VERSION_CONFLICT');
    return { document: stored, version: version + 1 };
  }
}
