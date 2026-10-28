import type { CvDocument, Question } from '@cv/shared';
import { cvDocument } from './mock-api';

/** A CV with two positions, one education entry, skills and an additional section: enough for every editor test. */
export function editorDocument(overrides: Partial<CvDocument> = {}): CvDocument {
  return cvDocument({
    contacts: {
      fullName: 'Iryna Kovalenko',
      email: 'iryna@example.com',
      phone: '',
      location: 'Kyiv, Ukraine',
      links: [],
    },
    experience: [
      {
        id: 'pos-1',
        company: 'Northwind Learning',
        title: 'Senior Full-Stack Engineer',
        location: 'Kyiv, Ukraine',
        start: '2023-03',
        end: null,
        current: true,
        bullets: [
          {
            id: 'b-1',
            text: 'Led the migration of the web checkout to Next.js 14.',
            factIds: ['f1'],
          },
          { id: 'b-2', text: 'Designed a PostgreSQL-backed job queue.', factIds: ['f2'] },
        ],
      },
      {
        id: 'pos-2',
        company: 'Brightpath Studio',
        title: 'Full-Stack Engineer',
        start: '2021-01',
        end: '2023-02',
        current: false,
        bullets: [{ id: 'b-3', text: 'Developed REST APIs in NestJS.', factIds: ['f3'] }],
      },
    ],
    education: [
      {
        id: 'edu-1',
        institution: 'State University of Technology',
        degree: 'MSc in Computer Science',
        start: '2017',
        end: '2019',
      },
    ],
    skills: [
      { id: 'sk-1', name: 'TypeScript' },
      { id: 'sk-2', name: 'React' },
    ],
    additional: [
      {
        id: 'add-1',
        title: 'Languages',
        items: [
          { id: 'l-1', text: 'Ukrainian — native', factIds: [] },
          { id: 'l-2', text: 'English — C1', factIds: [] },
        ],
      },
    ],
    ...overrides,
  });
}

export function question(overrides: Partial<Question> = {}): Question {
  return {
    id: '5d1f0a77-3c2e-4b8a-9f61-2e8c7a4b9d10',
    kind: 'missing',
    target: { section: 'experience', itemId: 'pos-2', field: 'dates' },
    prompt: 'When did you work at Brightpath Studio?',
    context: 'Full-Stack Engineer · Brightpath Studio',
    answerType: 'dates',
    status: 'open',
    answer: null,
    applyStatus: null,
    applyNote: null,
    ...overrides,
  };
}
