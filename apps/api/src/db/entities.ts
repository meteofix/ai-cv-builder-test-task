import { Cv, CvSource } from './cv.entity.js';
import { GenerationJob, GenerationUsage } from './job.entity.js';
import { CvQuestion } from './question.entity.js';
import { Session, User } from './user.entity.js';

export * from './cv.entity.js';
export * from './job.entity.js';
export * from './question.entity.js';
export * from './user.entity.js';

/** Every entity of the schema; the schema migration in `migrations/` creates these tables (the later ones only move data). */
export const ENTITIES = [User, Session, Cv, CvSource, CvQuestion, GenerationJob, GenerationUsage];
