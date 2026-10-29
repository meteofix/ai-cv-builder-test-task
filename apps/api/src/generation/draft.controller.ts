import { EntityManager } from '@mikro-orm/postgresql';
import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { DraftResponse, NotInCvResponse } from '@cv/shared';
import { CurrentUser, type SessionUser } from '../common/current-user.js';
import { OwnedCvs } from '../common/owned-cvs.js';
import { CvSource } from '../db/entities.js';
import { sourceAnalysisSchema } from './compose/compose.js';

/**
 * `GET /api/cvs/:id/draft` and `GET /api/cvs/:id/not-in-cv`. The generation module owns the analysis of
 * the source, so it serves what is built from it.
 */
@Controller('cvs/:id')
export class DraftController {
  constructor(
    @Inject(OwnedCvs) private readonly cvs: OwnedCvs,
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  /** There is no draft before the author has written the CV: the screen shows the steps instead. */
  @Get('draft')
  async draft(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<DraftResponse> {
    await this.cvs.findOwned(id, user.id);
    return { draft: null };
  }

  @Get('not-in-cv')
  async notInCv(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<NotInCvResponse> {
    const cv = await this.cvs.findOwned(id, user.id);
    const source = await this.em.findOne(CvSource, { cv: cv.id });
    // Nothing before the first generation ends; a CV with no stored analysis has nothing to show.
    const analysis = sourceAnalysisSchema.safeParse(source?.facts);
    if (!analysis.success) return { items: [] };
    const { notInCv, coverage, orderReason } = analysis.data;
    return {
      items: notInCv,
      sourceCoverage: coverage,
      ...(orderReason ? { orderReason } : {}),
    };
  }
}
