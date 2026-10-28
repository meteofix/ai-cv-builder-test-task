import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { Cv, type ICv } from '../db/entities.js';
import { ApiError } from './api-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from a URL are checked before a query: an invalid uuid would reach Postgres and become a 500. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The only way to load a CV: every access is scoped to its owner. */
@Injectable()
export class OwnedCvs {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  /**
   * The CV with this id if `userId` owns it. A foreign, missing or malformed id is the same 404, so a caller
   * cannot tell another user's CV from a missing one. Pass `em` to load it inside a transaction.
   */
  async findOwned(id: string, userId: string, em: EntityManager = this.em): Promise<ICv> {
    if (!isUuid(id)) throw new ApiError('CV_NOT_FOUND');
    const cv = await em.findOne(Cv, { id, user: userId });
    if (!cv) throw new ApiError('CV_NOT_FOUND');
    return cv;
  }
}
