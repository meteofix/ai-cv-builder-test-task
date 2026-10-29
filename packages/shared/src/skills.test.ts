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
    // A label with a comma is cut whole; a line with stronger separators keeps its commas in names.
    [
      'Process, Tooling & Enablement: Process Improvement, Jira Automation',
      ['Process Improvement', 'Jira Automation'],
    ],
    [
      'Strategy · Activation, Retention & Monetization · OKRs',
      ['Strategy', 'Activation, Retention & Monetization', 'OKRs'],
    ],
    ['• Python, Go', ['Python', 'Go']],
    ['Figma, Sketch, Miro: expert', ['Figma', 'Sketch', 'Miro: expert']],
    ['Python, SQL, Excel;', ['Python', 'SQL', 'Excel']],
  ])('%j → %j', (line, skills) => {
    expect(splitSkills(line)).toEqual(skills);
  });
});

describe('splitList', () => {
  it.each([
    ['A · B, C & D · E', ['A', 'B, C & D', 'E']],
    ['Kotlin | Swift (iOS, macOS), Dart', ['Kotlin', 'Swift (iOS, macOS), Dart']],
    ['Python, (pandas; NumPy), SQL', ['Python', '(pandas; NumPy)', 'SQL']],
    ['· Figma · Miro', ['Figma', 'Miro']],
    ['AWS, GCP |', ['AWS', 'GCP']],
    ['Activation, Retention ·', ['Activation, Retention']],
  ])('%j → %j', (line, names) => {
    expect(splitList(line)).toEqual(names);
  });

  it('keeps a label the person typed: only a kept line of a CV loses it', () => {
    expect(splitList('Cloud: AWS, Python (pandas, NumPy)')).toEqual([
      'Cloud: AWS',
      'Python (pandas, NumPy)',
    ]);
  });
});
