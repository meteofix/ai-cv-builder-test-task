import { describe, expect, it } from 'vitest';
import { splitSkills } from './split-skills.js';

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
