import { Body, Controller, Get, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { credentialsSchema, ROUTES, type Credentials, type User } from '@cv/shared';
import type { FastifyReply } from 'fastify';
import { CurrentUser, Public, type SessionUser } from '../common/current-user.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../common/session-token.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../config/tokens.js';
import { AuthService, toUserDto } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(ROUTES.signup.status)
  @Post('signup')
  async signUp(
    @Body({ schema: credentialsSchema }) body: Credentials,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<User> {
    const { user, token } = await this.auth.signUp(body);
    this.setSessionCookie(reply, token);
    return user;
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(ROUTES.login.status)
  @Post('login')
  async logIn(
    @Body({ schema: credentialsSchema }) body: Credentials,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<User> {
    const { user, token } = await this.auth.logIn(body);
    this.setSessionCookie(reply, token);
    return user;
  }

  @HttpCode(ROUTES.logout.status)
  @Post('logout')
  async logOut(
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logOut(user.sessionId, user.id);
    // Same name and path as when it was set, otherwise the browser keeps the old cookie.
    const options = sessionCookieOptions(this.config);
    this.adapterHost.httpAdapter.clearCookie(reply, SESSION_COOKIE, options);
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): User {
    return toUserDto(user);
  }

  private setSessionCookie(reply: FastifyReply, token: string): void {
    const options = sessionCookieOptions(this.config);
    this.adapterHost.httpAdapter.setCookie(reply, SESSION_COOKIE, token, options);
  }
}
