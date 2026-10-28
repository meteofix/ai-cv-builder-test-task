import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppConfig } from '../../src/config/env.js';
import { Clock } from '../../src/generation/clock.js';
import type { JudgedItem } from '../../src/generation/generate/prompts.js';
import type { ExtractorOutput, WriterOutput } from '../../src/generation/generate/schemas.js';
import type { ExtractedFact } from '../../src/grounding/index.js';
import { LLM_SLEEP } from '../../src/llm/llm-client.js';
import { LlmTransport, type TransportRequest } from '../../src/llm/llm-transport.js';
import { createTestApp } from '../support/create-test-app.js';
import { FakeClock } from './fake-clock.js';
import { FakeLlmClient, type FakeAnswer } from './fake-llm.js';

/** The real pipeline with a scripted model, a hand-moved clock and no real waits between retries. */
export function pipelineHarness() {
  const fake = new FakeLlmClient();
  const clock = new FakeClock();
  return {
    fake,
    clock,
    start(config: Partial<AppConfig> = {}): Promise<NestFastifyApplication> {
      return createTestApp(config, {
        overrides: [
          { provide: LlmTransport, useValue: fake },
          { provide: Clock, useValue: clock },
          { provide: LLM_SLEEP, useValue: () => Promise.resolve() },
        ],
      });
    },
  };
}

/**
 * "The sample facts" of docs/specs/generation.md: the extractor output that quotes `SAMPLE_SOURCE_TEXT`
 * correctly. After verification they are renumbered in source order: f1 name, f2 email, f3 location,
 * f4 the Acme position, f5 its achievement, f6 education, f7–f9 the skills.
 */
export const SAMPLE_FACTS: ExtractedFact[] = [
  {
    id: 'name',
    kind: 'contact',
    quote: 'Iryna Kovalenko',
    contact: { field: 'fullName', value: 'Iryna Kovalenko' },
  },
  {
    id: 'mail',
    kind: 'contact',
    quote: 'iryna@example.com',
    contact: { field: 'email', value: 'iryna@example.com' },
  },
  { id: 'city', kind: 'contact', quote: 'Kyiv', contact: { field: 'location', value: 'Kyiv' } },
  {
    id: 'acme',
    kind: 'position',
    quote: 'Senior Engineer, Acme Corp, 2021 – present',
    position: {
      company: 'Acme Corp',
      title: 'Senior Engineer',
      location: null,
      start: '2021',
      end: null,
      current: true,
    },
  },
  {
    id: 'billing',
    kind: 'achievement',
    quote: 'Led the migration of the billing service to TypeScript.',
    achievement: { positionId: 'acme' },
  },
  {
    id: 'kpi',
    kind: 'education',
    quote: 'Kyiv Polytechnic Institute, BSc Computer Science, 2014 – 2018',
    education: {
      institution: 'Kyiv Polytechnic Institute',
      degree: 'BSc Computer Science',
      start: '2014',
      end: '2018',
    },
  },
  {
    id: 'ts',
    kind: 'skill',
    quote: 'TypeScript, PostgreSQL, React',
    skill: { name: 'TypeScript' },
  },
  {
    id: 'pg',
    kind: 'skill',
    quote: 'TypeScript, PostgreSQL, React',
    skill: { name: 'PostgreSQL' },
  },
  { id: 'react', kind: 'skill', quote: 'TypeScript, PostgreSQL, React', skill: { name: 'React' } },
];

export const SAMPLE_HEADINGS = ['Experience', 'Education', 'Skills'];

export function extractorAnswer(overrides: Partial<ExtractorOutput> = {}): FakeAnswer {
  return {
    output: {
      locale: 'en',
      facts: SAMPLE_FACTS,
      sectionHeadings: SAMPLE_HEADINGS,
      ignoredInstructions: [],
      ...overrides,
    } satisfies ExtractorOutput,
  };
}

export const SAMPLE_BULLET = 'Led the billing service migration to TypeScript.';

export function writerAnswer(overrides: Partial<WriterOutput> = {}): FakeAnswer {
  return {
    output: {
      summary: [
        { text: 'Senior engineer who moved billing to TypeScript.', factIds: ['f4', 'f5'] },
      ],
      positions: [{ positionId: 'f4', bullets: [{ text: SAMPLE_BULLET, factIds: ['f5'] }] }],
      experienceOrder: ['f4'],
      skills: ['f7', 'f8', 'f9'],
      ...overrides,
    } satisfies WriterOutput,
  };
}

/** The items the judge was asked about, read back from its request. */
export function judgedItems(request: TransportRequest<unknown>): JudgedItem[] {
  const input = request.messages[0]?.content ?? '';
  const json = /<cv_source>\n([\s\S]*)\n<\/cv_source>/.exec(input)?.[1] ?? '{"items":[]}';
  return (JSON.parse(json) as { items: JudgedItem[] }).items;
}

/** A judge that supports every item except those `reject` returns a class for. */
export function judgeAnswer(
  reject: (item: JudgedItem) => string | null = () => null,
  omit: (item: JudgedItem) => boolean = () => false,
): FakeAnswer {
  return (request) => ({
    output: {
      verdicts: judgedItems(request)
        .filter((item) => !omit(item))
        .map((item) => {
          const rejected = reject(item);
          return rejected === null
            ? { itemId: item.id, supported: true }
            : { itemId: item.id, supported: false, class: rejected, reason: 'not in the quotes' };
        }),
    },
  });
}
