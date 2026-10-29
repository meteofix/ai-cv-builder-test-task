import { describe, expect, it } from 'vitest';
import { splitList, splitSkills } from './skills.js';

describe('splitSkills', () => {
  it.each([
    ['TypeScript, React, Node.js', ['TypeScript', 'React', 'Node.js']],
    ['Python (pandas, NumPy), SQL', ['Python (pandas, NumPy)', 'SQL']],
    ['Cloud: AWS · GCP | Azure', ['AWS', 'GCP', 'Azure']],
    ['Go; Rust • C++', ['Go', 'Rust', 'C++']],
    ['CI/CD, A/B testing.', ['CI/CD', 'A/B testing']],
    ['React, TypeScript,, Node.js', ['React', 'TypeScript', 'Node.js']],
    ['Мови: Python, Go', ['Python', 'Go']],
  ])('%j → %j', (line, skills) => {
    expect(splitSkills(line)).toEqual(skills);
  });
});

describe('splitList', () => {
  it('keeps a label the person typed: only a kept line of a CV loses it', () => {
    expect(splitList('Cloud: AWS, Python (pandas, NumPy)')).toEqual([
      'Cloud: AWS',
      'Python (pandas, NumPy)',
    ]);
  });
});
