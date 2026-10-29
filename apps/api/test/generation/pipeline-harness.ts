import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppConfig } from '../../src/config/env.js';
import { Clock } from '../../src/generation/clock.js';
import {
  COVERAGE_SYSTEM,
  REPAIR_SYSTEM,
  type JudgedItem,
} from '../../src/generation/generate/prompts.js';
import type {
  ExtractorOutput,
  RepairOutput,
  WriterOutput,
} from '../../src/generation/generate/schemas.js';
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

/** A fact as the extractor answers it: the server numbers facts itself. */
function withoutId(fact: Exclude<ExtractedFact, { kind: 'position' | 'achievement' }>) {
  return Object.fromEntries(
    Object.entries(fact).filter(([key]) => key !== 'id'),
  ) as ExtractorOutput['facts'][number];
}

/** What a test scripts for the extractor: the flat facts it means, nested by `nestFacts`. */
export interface ExtractorScript extends Omit<Partial<ExtractorOutput>, 'facts'> {
  facts?: ExtractedFact[];
}

export function extractorAnswer(
  overrides: ExtractorScript = {},
  repair: RepairOutput = { fixes: [] },
): FakeAnswer {
  const { facts = SAMPLE_FACTS, ...rest } = overrides;
  const output = {
    locale: 'en',
    sectionHeadings: SAMPLE_HEADINGS,
    ignoredInstructions: [],
    ...nestFacts(facts),
    ...rest,
  } satisfies ExtractorOutput;
  // The extract step may ask the extractor again, to fix dropped quotes and to read uncovered lines; by
  // default it fixes none and finds nothing more.
  return (request) => ({
    output:
      request.system === REPAIR_SYSTEM
        ? repair
        : request.system === COVERAGE_SYSTEM
          ? { bullets: [], experience: [], facts: [], sectionHeadings: [], ignoredInstructions: [] }
          : output,
  });
}

/**
 * Flat test facts as the extractor answers: each position is its own group (its quote names the
 * company), an achievement a bullet of its position's group, and an achievement of an unknown position
 * a bullet of a group without positions. Ids are the server's to assign, so the facts' own ids go.
 */
export function nestFacts(
  facts: readonly ExtractedFact[],
): Pick<ExtractorOutput, 'experience' | 'facts'> {
  const positions = facts.filter((fact) => fact.kind === 'position');
  const experience: ExtractorOutput['experience'] = positions.map((fact) => ({
    company: fact.position.company,
    companyQuote: fact.position.companyQuote ?? fact.quote,
    positions: [
      {
        quote: fact.quote,
        ...(fact.vague ? { vague: true } : {}),
        title: fact.position.title,
        location: fact.position.location,
        start: fact.position.start,
        end: fact.position.end,
        current: fact.position.current,
      },
    ],
    bullets: [],
  }));
  const orphans: ExtractorOutput['experience'][number] = {
    company: '',
    companyQuote: '',
    positions: [],
    bullets: [],
  };
  const others: ExtractorOutput['facts'] = [];
  for (const fact of facts) {
    if (fact.kind === 'position') continue;
    if (fact.kind === 'achievement') {
      const index = positions.findIndex((position) => position.id === fact.achievement.positionId);
      const bullet = { quote: fact.quote, position: 0, ...(fact.vague ? { vague: true } : {}) };
      (experience[index] ?? orphans).bullets.push(bullet);
      continue;
    }
    others.push(withoutId(fact));
  }
  return {
    experience: orphans.bullets.length > 0 ? [...experience, orphans] : experience,
    facts: others,
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
