import { describe, expect, it } from 'vitest';
import {
  hashSessionToken,
  newSessionToken,
  readCookie,
  sessionCookieOptions,
} from './session-token.js';

describe('readCookie', () => {
  it.each([
    ['sid=abc', 'abc'],
    ['theme=dark; sid=abc; lang=en', 'abc'],
    ['sid=first; sid=second', 'first'],
    ['xsid=abc', undefined],
    ['sid', undefined],
    ['', undefined],
  ])('reads sid from %j', (header, expected) => {
    expect(readCookie(header, 'sid')).toBe(expected);
  });

  it('handles a missing header', () => {
    expect(readCookie(undefined, 'sid')).toBeUndefined();
  });
});

describe('session token', () => {
  it('is random and URL-safe', () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(newSessionToken()).not.toBe(token);
  });

  it('is stored as a SHA-256 hex digest, never as itself', () => {
    const token = newSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe('session cookie options', () => {
  it.each([[true], [false]])('is httpOnly, SameSite=Lax and Secure=%s from config', (secure) => {
    expect(sessionCookieOptions({ COOKIE_SECURE: secure, SESSION_TTL_DAYS: 30 })).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
  });
});
