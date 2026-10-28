import { EntityManager } from '@mikro-orm/postgresql';
import { Controller, Get, Inject, Param } from '@nestjs/common';
import { cvDocumentSchema, type DraftResponse, type NotInCvResponse } from '@cv/shared';
import { CurrentUser, type SessionUser } from '../common/current-user.js';
import { OwnedCvs } from '../common/owned-cvs.js';
import { buildNotInCv } from './generate/not-in-cv.js';
import { buildSkeleton } from './generate/skeleton.js';
import { loadSource, removedProse } from './generate/source-facts.js';

/**
 * `GET /api/cvs/:id/draft` and `GET /api/cvs/:id/not-in-cv`. The generation module owns the facts, so it
 * serves what is built from them; nothing here is stored.
 */
@Controller('cvs/:id')
export class DraftController {
  constructor(
    @Inject(OwnedCvs) private readonly cvs: OwnedCvs,
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  /** The skeleton from the extracted facts while the document is still empty (the same function as finalize). */
  @Get('draft')
  async draft(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<DraftResponse> {
    const cv = await this.cvs.findOwned(id, user.id);
    if (cv.document) return { draft: null };
    const source = await loadSource(this.em, cv.id);
    if (!source?.facts) return { draft: null };
    const document = buildSkeleton({
      source: source.text,
      facts: source.facts.facts,
      targetRole: cv.targetRole,
      locale: source.facts.locale,
    });
    return { draft: cvDocumentSchema.parse(document) };
  }

  @Get('not-in-cv')
  async notInCv(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<NotInCvResponse> {
    const cv = await this.cvs.findOwned(id, user.id);
    const source = await loadSource(this.em, cv.id);
    if (!source?.facts) return { items: [] };
    return {
      items: buildNotInCv({
        source: source.text,
        sourceFacts: source.facts,
        document: cv.document ?? null,
        removed: await removedProse(this.em, cv.id),
      }),
    };
  }
}
