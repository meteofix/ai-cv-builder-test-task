import { afterEach, describe, expect, it } from 'vitest';
import { concerns, showInCv } from './showInCv';

describe('concerns — a question about a job or entry, or one of its groups', () => {
  it.each([
    [{ section: 'experience', itemId: 'p1' }, 'p1', true],
    [{ section: 'experience', itemId: 'p1-g2' }, 'p1', true],
    [{ section: 'experience', itemId: 'p10-g1' }, 'p1', false],
    [{ section: 'additional', itemId: 'a1-e1-g1' }, 'a1-e1', true],
    [{ section: 'additional', itemId: 'a1-e1-g1' }, 'a1', false],
    [{ section: 'summary' }, 'p1', false],
    [null, 'p1', false],
  ] as const)('%j about %s → %s', (target, id, expected) => {
    const section = target?.section === 'additional' ? 'additional' : 'experience';
    expect(concerns(target, section, id)).toBe(expected);
  });
});

describe('showInCv — where a question scrolls to', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const add = (id: string) => {
    const element = document.createElement('div');
    element.id = id;
    document.body.append(element);
    return element;
  };

  it('highlights the group the question is about', () => {
    add('item-p1');
    const group = add('item-p1-g2');
    showInCv({ section: 'experience', itemId: 'p1-g2' });
    expect(group.hasAttribute('data-flash')).toBe(true);
  });

  it('falls back to the job when its group was removed', () => {
    const job = add('item-p1');
    showInCv({ section: 'experience', itemId: 'p1-g7' });
    expect(job.hasAttribute('data-flash')).toBe(true);
  });
});
