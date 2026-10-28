import { randomUUID } from 'node:crypto';
import { defineEntity, p, type InferEntity } from '@mikro-orm/core';
import {
  ANSWER_TYPES,
  APPLY_STATUSES,
  QUESTION_KINDS,
  QUESTION_STATUSES,
  type Answer,
  type QuestionTarget,
} from '@cv/shared';
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
    kind: p.enum(QUESTION_KINDS),
    target: p.json<QuestionTarget>(),
    prompt: p.text(),
    context: p.text().nullable(),
    answerType: p.enum(ANSWER_TYPES),
    status: p.enum(QUESTION_STATUSES).default('open'),
    answer: p.json<Answer>().nullable(),
    // Set once an answer is submitted: `applying` while its job runs, then the outcome.
    applyStatus: p.enum(APPLY_STATUSES).nullable(),
    applyNote: p.text().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
});

export type ICvQuestion = InferEntity<typeof CvQuestion>;
