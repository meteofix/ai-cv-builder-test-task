import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Cv, type ICv } from '../db/entities.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only way to load a CV: every access is scoped to its owner. */
@Injectable()
export class OwnedCvs {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  /**
   * The CV with this id if `userId` owns it. A foreign, missing or malformed id is the same 404, so a caller
   * cannot tell another user's CV from a missing one. Pass `em` to load it inside a transaction.
   */
  async findOwned(id: string, userId: string, em: EntityManager = this.em): Promise<ICv> {
    // A malformed id would reach Postgres as an invalid uuid and become a 500.
    if (!UUID.test(id)) throw new NotFoundException();
    const cv = await em.findOne(Cv, { id, user: userId });
    if (!cv) throw new NotFoundException();
    return cv;
  }
}
