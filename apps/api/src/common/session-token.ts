import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@nestjs/common';
import type { AppConfig } from '../config/env.js';

/** Name of the session cookie; the session guard reads it and login (auth module) sets it. */
export const SESSION_COOKIE = 'sid';

/** 256 random bits, URL-safe, so the cookie value needs no encoding. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored: a leaked `sessions` row cannot be used as a cookie. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry(config: Pick<AppConfig, 'SESSION_TTL_DAYS'>, now = new Date()): Date {
  return new Date(now.getTime() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Lax keeps the cookie on top-level navigation from other sites but not on their POSTs; `Secure` follows
 * COOKIE_SECURE because the app is also served over plain HTTP on a LAN.
 */
export function sessionCookieOptions(
  config: Pick<AppConfig, 'COOKIE_SECURE' | 'SESSION_TTL_DAYS'>,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    maxAge: config.SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

/**
 * Value of one cookie from a `Cookie` header. Nest parses cookies only for `@Cookies()` parameters, not for
 * guards, so the guard reads the header itself. The first occurrence wins, as in Nest and browsers.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}
