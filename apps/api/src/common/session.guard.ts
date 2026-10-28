import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Session } from '../db/entities.js';
import { ApiError } from './api-error.js';
import { IS_PUBLIC, type RequestWithUser } from './current-user.js';
import { hashSessionToken, readCookie, SESSION_COOKIE } from './session-token.js';

/**
 * Global guard: a route needs a live session unless it is marked `@Public()`. Registered once in
 * CommonModule, so a new controller is protected without doing anything.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const cookieHeader = request.headers.cookie;
    const token = readCookie(
      typeof cookieHeader === 'string' ? cookieHeader : undefined,
      SESSION_COOKIE,
    );
    if (!token) throw new ApiError('UNAUTHENTICATED');

    const session = await this.em
      .fork()
      .findOne(
        Session,
        { tokenHash: hashSessionToken(token), expiresAt: { $gt: new Date() } },
        { populate: ['user'] },
      );
    if (!session) throw new ApiError('UNAUTHENTICATED');

    request.user = {
      id: session.user.id,
      email: session.user.getEntity().email,
      sessionId: session.id,
    };
    return true;
  }
}
