import { LIMITS } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { authorAnswer } from '../../../test/generation/compose-fixture.js';
import { draftContacts } from './draft-contacts.js';

const links = (values: string[]) =>
  authorAnswer({
    contacts: values.map((value, i) => ({ field: 'link' as const, value, segment: `S${i + 1}` })),
  });

describe('draftContacts — which contact lines count as placed', () => {
  it('lists a repeated handle once and counts both of its lines as placed', () => {
    const source = 'Signal: @ann_k77\nSignal: @ann_k77';
    const contacts = draftContacts(links(['Signal: @ann_k77', 'Signal: @ann_k77']), source);
    expect(contacts.notLinks).toEqual(['Signal: @ann_k77']);
    expect(contacts.contactSegments).toEqual(['S1', 'S2']);
  });

  it('keeps at most the limit of links; the line of one past it is not placed', () => {
    const values = Array.from({ length: LIMITS.maxLinks + 1 }, (_, i) => `example.com/p${i}`);
    const contacts = draftContacts(links(values), values.join('\n'));
    expect(contacts.links).toHaveLength(LIMITS.maxLinks);
    expect(contacts.contactSegments).not.toContain(`S${LIMITS.maxLinks + 1}`);
  });
});
