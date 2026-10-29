/** Mechanical checks against the source (docs/specs/grounding.md). Pure functions: no Nest, database or SDK. */
export * from './facts.js';
export { findQuote, indexText, normalizeText, type QuoteIndex } from './find-quote.js';
export { instructionFragments, sourceLines, type SourceLine } from './instructions.js';
export {
  checkNumbers,
  checkOrder,
  checkReferences,
  numberTokens,
  selectSkills,
  type NumberCheck,
} from './prose.js';
export { contentLines, uncoveredLines } from './uncovered.js';
export { overlaps } from './span.js';
export { verifyFacts, type VerifiedFacts } from './verify-facts.js';
