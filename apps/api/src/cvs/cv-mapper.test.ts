import { describe, expect, it } from 'vitest';
import type { ICv } from '../db/entities.js';
import { cvState } from './cv-mapper.js';

const cv = (withDocument: boolean) => ({ document: withDocument ? {} : null }) as unknown as ICv;

describe('cvState', () => {
  it.each([
    ['no job, no document', false, undefined, 'generating'],
    ['no job, with document', true, undefined, 'ready'],
    ['generate queued', false, { kind: 'generate', status: 'queued' }, 'generating'],
    ['generate running', false, { kind: 'generate', status: 'running' }, 'generating'],
    ['generate failed, no document', false, { kind: 'generate', status: 'failed' }, 'failed'],
    ['generate failed, with document', true, { kind: 'generate', status: 'failed' }, 'ready'],
    ['generate succeeded', true, { kind: 'generate', status: 'succeeded' }, 'ready'],
    ['apply_answer queued', true, { kind: 'apply_answer', status: 'queued' }, 'updating'],
    ['apply_answer running', true, { kind: 'apply_answer', status: 'running' }, 'updating'],
    ['apply_answer failed', true, { kind: 'apply_answer', status: 'failed' }, 'ready'],
    ['apply_answer succeeded', true, { kind: 'apply_answer', status: 'succeeded' }, 'ready'],
  ] as const)('%s → %s', (_name, withDocument, job, expected) => {
    expect(cvState(cv(withDocument), job)).toBe(expected);
  });
});
