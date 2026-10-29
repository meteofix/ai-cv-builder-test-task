import { describe, expect, it } from 'vitest';
import { skillsOf } from './SkillsSection';

const before = [
  { id: 'k1', name: 'Javascript', factId: 'S9' },
  { id: 'k2', name: 'Python (pandas, NumPy)', factId: 'S9' },
];

describe('skillsOf', () => {
  it('keeps a skill spelled as before with its id and provenance, brackets included', () => {
    expect(skillsOf('Javascript, Python (pandas, NumPy)', before)).toEqual(before);
  });

  it('takes a case-only change as the person’s text: same id, no provenance', () => {
    expect(skillsOf('JavaScript, Python (pandas, NumPy)', before)).toEqual([
      { id: 'k1', name: 'JavaScript' },
      before[1],
    ]);
  });

  it('makes a repeated name one skill, so no two skills share an id', () => {
    const next = skillsOf('React, react, Go', []);
    expect(next.map((skill) => skill.name)).toEqual(['React', 'Go']);
    expect(new Set(next.map((skill) => skill.id)).size).toBe(2);
  });

  it('keeps the id of a skill being retyped at its place', () => {
    expect(skillsOf('Javasc', before)[0]?.id).toBe('k1');
  });
});
