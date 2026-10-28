import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

/** The signed-in user that the session guard attaches to the request. */
export interface SessionUser {
  id: string;
  email: string;
  /** Id of the `sessions` row; logout deletes it. */
  sessionId: string;
}

export interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: SessionUser;
}

export const IS_PUBLIC = Symbol('isPublic');

/** Opens a route to anonymous requests. Every other route requires a session (deny by default). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Injects the signed-in user. Only valid on routes the session guard protects, which is all but `@Public()`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<RequestWithUser>().user;
  // The guard runs before parameter decorators, so this only fires on a `@Public()` route by mistake.
  if (!user) throw new Error('@CurrentUser() used on a route without a session');
  return user;
});
