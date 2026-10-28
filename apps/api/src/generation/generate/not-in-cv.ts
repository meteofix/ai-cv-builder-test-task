import type { CvDocument, NotInCvItem } from '@cv/shared';
import type { Fact } from '../../grounding/index.js';
import { positionLabel } from './questions.js';
import type { RemovedItem, SourceFacts } from './schemas.js';
import { verbatim, withScheme } from './skeleton.js';

/**
 * "Not in your CV" (docs/specs/generation.md §4.2): removed prose, facts the CV does not use, ignored
 * instruction lines and lines no fact covers — grouped in that order, in source order inside a group.
 */
export function buildNotInCv(input: {
  source: string;
  sourceFacts: SourceFacts;
  document: CvDocument | null;
  removed: readonly RemovedItem[];
}): NotInCvItem[] {
  const { source, sourceFacts, document } = input;
  const facts = sourceFacts.facts;
  const positions = new Map(
    facts.flatMap((fact) => (fact.kind === 'position' ? [[fact.id, fact] as const] : [])),
  );
  const contextOf = (positionId: string | null) => {
    const position = positionId === null ? undefined : positions.get(positionId);
    return position ? positionLabel(position.position) : 'Summary';
  };
  // Summary sentences have no place in the source; they come first, bullets follow their position.
  const order = (positionId: string | null) =>
    positionId === null ? -1 : (positions.get(positionId)?.span[0] ?? Number.MAX_SAFE_INTEGER);

  const unverified = [...input.removed]
    .sort((a, b) => order(a.positionId) - order(b.positionId))
    .map((item): NotInCvItem => ({
      text: item.text,
      reason: 'unverified',
      context: contextOf(item.positionId),
    }));

  const unused: NotInCvItem[] = [];
  if (document) {
    // Anything the document does not show: left out by the writer, cut by `LIMITS`, or removed by hand.
    const referenced = referencedFactIds(document);
    for (const fact of facts) {
      if (fact.kind === 'contact' ? contactShown(fact, document) : referenced.has(fact.id))
        continue;
      unused.push({
        text: verbatim(source, fact),
        reason: 'unused',
        ...(fact.kind === 'achievement' ? { context: contextOf(fact.achievement.positionId) } : {}),
      });
    }
  }

  const ignored = sourceFacts.instructionSpans.map(([start, end]): NotInCvItem => ({
    text: source.slice(start, end).trim(),
    reason: 'ignored',
  }));
  const notRecognized = sourceFacts.uncoveredLines.map((text): NotInCvItem => ({
    text,
    reason: 'not_recognized',
  }));
  return [...unverified, ...unused, ...ignored, ...notRecognized];
}

/** Contacts carry no fact id in the document; a contact is shown when its value is. */
function contactShown(fact: Extract<Fact, { kind: 'contact' }>, document: CvDocument): boolean {
  const { fullName, email, phone, location, links } = document.contacts;
  const value = fact.contact.value;
  return [fullName, email, phone, location].includes(value) || links.includes(withScheme(value));
}

function referencedFactIds(document: CvDocument): Set<string> {
  const ids = new Set<string>(document.summary.factIds);
  const add = (id: string | undefined) => {
    if (id) ids.add(id);
  };
  for (const job of document.experience) {
    add(job.factId);
    for (const bullet of job.bullets) bullet.factIds.forEach(add);
  }
  for (const item of [...document.education, ...document.skills]) add(item.factId);
  for (const section of document.additional) {
    for (const item of section.items) item.factIds.forEach(add);
  }
  return ids;
}
