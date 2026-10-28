import { randomBytes } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { Credentials, User as UserDto } from '@cv/shared';
import { hash, verify } from 'argon2';
import type { Logger } from 'pino';
import { ApiError } from '../common/api-error.js';
import { hashSessionToken, newSessionToken, sessionExpiry } from '../common/session-token.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG, ROOT_LOGGER } from '../config/tokens.js';
import { Session, User, type IUser } from '../db/entities.js';

export interface SignedIn {
  user: UserDto;
  /** The cookie value; only its hash is stored. */
  token: string;
}

@Injectable()
export class AuthService {
  private readonly logger: Logger;
  /** Verified against when the email is unknown, so both login failures cost one argon2 run. */
  private readonly dummyHash = hash(randomBytes(16).toString('hex'));

  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ROOT_LOGGER) logger: Logger,
  ) {
    this.logger = logger.child({ context: 'auth' });
  }

  async signUp({ email, password }: Credentials): Promise<SignedIn> {
    const em = this.em.fork();
    // A taken email is refused before the slow, memory-hungry hash; the unique index below stays the final check.
    if (await em.count(User, { email })) throw new ApiError('EMAIL_TAKEN');
    const passwordHash = await hash(password);
    try {
      const signedIn = await em.transactional(async (tx) => {
        const user = tx.create(User, { email, passwordHash });
        const token = this.startSession(tx, user);
        await tx.flush();
        return { user: toUserDto(user), token };
      });
      this.logger.info({ userId: signedIn.user.id }, 'signup succeeded');
      return signedIn;
    } catch (error) {
      // Two sign-ups with one email can both pass the check above; the loser lands here.
      if (error instanceof UniqueConstraintViolationException) throw new ApiError('EMAIL_TAKEN');
      throw error;
    }
  }

  async logIn({ email, password }: Credentials): Promise<SignedIn> {
    const em = this.em.fork();
    const user = await em.findOne(User, { email });
    const valid = await verify(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user || !valid) {
      this.logger.info('login failed');
      throw new ApiError('INVALID_CREDENTIALS');
    }
    const token = this.startSession(em, user);
    await em.flush();
    this.logger.info({ userId: user.id }, 'login succeeded');
    return { user: toUserDto(user), token };
  }

  /** Deleting the row is what revokes the cookie: the guard looks the session up on every request. */
  async logOut(sessionId: string, userId: string): Promise<void> {
    await this.em.fork().nativeDelete(Session, { id: sessionId, user: userId });
    this.logger.info({ userId }, 'logout');
  }

  private startSession(em: EntityManager, user: IUser): string {
    const token = newSessionToken();
    em.create(Session, {
      user,
      tokenHash: hashSessionToken(token),
      expiresAt: sessionExpiry(this.config),
    });
    return token;
  }
}

export function toUserDto(user: Pick<IUser, 'id' | 'email'>): UserDto {
  return { id: user.id, email: user.email };
}
