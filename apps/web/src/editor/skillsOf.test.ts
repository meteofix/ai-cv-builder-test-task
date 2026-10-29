import { describe, expect, it } from 'vitest';
import { skillsLine, skillsOf } from './SkillsSection';

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

  it('reads back the line it shows as the same skills, also a name with a comma of its own', () => {
    const withComma = [...before, { id: 'k3', name: 'Activation, Retention & Monetization' }];
    expect(skillsLine(before)).toBe('Javascript, Python (pandas, NumPy)');
    expect(skillsLine(withComma)).toBe(
      'Javascript · Python (pandas, NumPy) · Activation, Retention & Monetization',
    );
    expect(skillsOf(skillsLine(withComma), withComma)).toEqual(withComma);
    const alone = [{ id: 'k4', name: 'Activation, Retention' }];
    expect(skillsLine(alone)).toBe('Activation, Retention ·');
    expect(skillsOf(skillsLine(alone), alone)).toEqual(alone);
  });

  it('cuts a typed line with dots between names only there', () => {
    expect(
      skillsOf('Strategy · Activation, Retention · OKRs', []).map((skill) => skill.name),
    ).toEqual(['Strategy', 'Activation, Retention', 'OKRs']);
  });
});
