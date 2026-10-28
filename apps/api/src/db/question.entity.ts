import { randomUUID } from 'node:crypto';
import { defineEntity, p, type InferEntity } from '@mikro-orm/core';
import { Cv } from './cv.entity.js';

export const CvQuestion = defineEntity({
  name: 'CvQuestion',
  tableName: 'cv_questions',
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    cv: () => p.manyToOne(Cv).ref().deleteRule('cascade').index(),
    kind: p.enum(['missing', 'vague', 'unverified']),
    target: p.json<Record<string, unknown>>(),
    prompt: p.text(),
    context: p.text().nullable(),
    answerType: p.enum(['dates', 'text']),
    status: p.enum(['open', 'answered', 'dismissed']).default('open'),
    answer: p.json<Record<string, unknown>>().nullable(),
    // Set once an answer is submitted: `applying` while its job runs, then the outcome.
    applyStatus: p.enum(['applying', 'applied', 'partial', 'failed']).nullable(),
    applyNote: p.text().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export type ICvQuestion = InferEntity<typeof CvQuestion>;
