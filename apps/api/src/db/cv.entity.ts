import { randomUUID } from 'node:crypto';
import { defineEntity, p, type InferEntity } from '@mikro-orm/core';
import type { CvDocument } from '@cv/shared';
import { User } from './user.entity.js';

export const Cv = defineEntity({
  name: 'Cv',
  tableName: 'cvs',
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    user: () => p.manyToOne(User).ref().deleteRule('cascade'),
    targetRole: p.string().length(200),
    // Null until the first generation finishes; the staged draft is built from the facts instead.
    document: p.json<CvDocument>().nullable(),
    // Changes only together with `document`; the generation status lives in the latest job.
    version: p.integer().default(0),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
  indexes: [{ properties: ['user', 'updatedAt'] }],
});

export type ICv = InferEntity<typeof Cv>;

/** Only the extracted text of an upload is kept, never the PDF itself. */
export const CvSource = defineEntity({
  name: 'CvSource',
  tableName: 'cv_sources',
  properties: {
    cv: () => p.oneToOne(Cv).primary().owner().ref().deleteRule('cascade'),
    kind: p.enum(['pdf', 'text']),
    text: p.text(),
    // Facts with verbatim quotes and spans; the grounding module owns their shape.
    facts: p.json<Record<string, unknown>>().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});

export type ICvSource = InferEntity<typeof CvSource>;
