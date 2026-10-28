import { randomUUID } from 'node:crypto';
import { defineEntity, p, type InferEntity } from '@mikro-orm/core';

export const User = defineEntity({
  name: 'User',
  tableName: 'users',
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    // Stored trimmed and lower-cased, so the unique index also rejects case variants.
    email: p.string().length(254).unique(),
    passwordHash: p.text(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});

export type IUser = InferEntity<typeof User>;

export const Session = defineEntity({
  name: 'Session',
  tableName: 'sessions',
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    user: () => p.manyToOne(User).ref().deleteRule('cascade').index(),
    // SHA-256 of the cookie token: a leaked database row cannot be replayed as a cookie.
    tokenHash: p.string().length(64).unique(),
    createdAt: p.datetime().onCreate(() => new Date()),
    expiresAt: p.datetime(),
  },
});

export type ISession = InferEntity<typeof Session>;
