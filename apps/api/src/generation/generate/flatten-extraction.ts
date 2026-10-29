import type { ExtractedFact } from '../../grounding/index.js';
import type { ExtractorOutput } from './schemas.js';

/**
 * The extractor's nested answer as the flat facts grounding verifies, with ids the server assigns: a
 * position takes its company from its group and keeps the group's quote, so the company is checked where
 * the CV writes it; a bullet becomes an achievement of the position it names, and a bullet the group
 * shares (or one naming no position of the group) an achievement of the group's first position. A group
 * without positions gives its bullets a position id that does not exist, so grounding finds them no
 * position of their own.
 */
export function flattenExtraction(
  output: Pick<ExtractorOutput, 'experience' | 'facts'>,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  output.experience.forEach((group, g) => {
    const ids = group.positions.map((_, p) => `g${g}p${p}`);
    group.positions.forEach(({ quote, vague, ...position }, p) => {
      facts.push({
        id: `g${g}p${p}`,
        kind: 'position',
        quote,
        ...(vague ? { vague } : {}),
        position: {
          ...position,
          company: group.company,
          ...(group.companyQuote.trim() ? { companyQuote: group.companyQuote } : {}),
        },
      });
    });
    group.bullets.forEach(({ quote, vague, position }, b) => {
      const positionId = (position === null ? undefined : ids[position]) ?? ids[0] ?? `g${g}`;
      facts.push({
        id: `g${g}b${b}`,
        kind: 'achievement',
        quote,
        ...(vague ? { vague } : {}),
        achievement: { positionId },
      });
    });
  });
  output.facts.forEach((fact, i) => facts.push({ ...fact, id: `x${i}` }));
  return facts;
}
