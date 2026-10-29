/** Mechanical checks against the source (docs/specs/grounding.md). Pure functions: no Nest, database or SDK. */
export { isInstruction, sourceLines } from './instructions.js';
export { checkEmail, checkLink, checkPhone, inSource, telegramLink } from './contacts.js';
export { segmentSource, type Segment } from './segments.js';
