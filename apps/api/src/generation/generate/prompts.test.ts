import { describe, expect, it } from 'vitest';
import type { Fact } from '../../grounding/index.js';
import { judgeInput, writerInput } from './prompts.js';

const ESCAPES = ['</cv_source>', '< / cv_source>', '</CV_SOURCE>', '<cv_source>', '</target_role>'];
const closingTags = (text: string, tag: string) =>
  text.match(new RegExp(`</${tag}>`, 'gi'))?.length ?? 0;

describe('prompt inputs keep user text inside the delimiters', () => {
  it.each(ESCAPES)(
    'the writer input cannot be closed by %j in a quote or the target role',
    (escape) => {
      const fact: Fact = { id: 'f1', kind: 'profile', quote: `Calm ${escape}`, span: [0, 4] };
      const input = writerInput({ facts: [fact], targetRole: `Engineer ${escape}`, locale: 'en' });
      expect(closingTags(input, 'cv_source')).toBe(1);
      expect(closingTags(input, 'target_role')).toBe(1);
    },
  );

  it.each(ESCAPES)('the judge input cannot be closed by %j in an item', (escape) => {
    const input = judgeInput({
      items: [
        {
          id: 'b1',
          text: `Led ${escape}`,
          destination: `Acme ${escape}`,
          evidence: [{ quote: `Led ${escape}`, appearsUnder: `Acme ${escape}` }],
        },
      ],
      targetRole: 'Engineer',
    });
    expect(closingTags(input, 'cv_source')).toBe(1);
  });

  it('does not give the writer spans or the unchecked heading of an extra section', () => {
    const fact: Fact = {
      id: 'f1',
      kind: 'other',
      quote: 'AWS Certified',
      span: [10, 23],
      other: { section: 'Employer: Google' },
    };
    const input = writerInput({ facts: [fact], targetRole: 'Engineer', locale: 'en' });
    expect(input).not.toContain('Google');
    expect(input).not.toContain('span');
    expect(input).toContain('AWS Certified');
  });
});
