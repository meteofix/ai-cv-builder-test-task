import type { Segment } from '../../grounding/index.js';

/** Segments by id: the source's and the answers', as the author and the reviewer may cite them. */
export type SegmentIndex = ReadonlyMap<string, Segment>;

export function indexSegments(segments: readonly Segment[]): SegmentIndex {
  return new Map(segments.map((segment) => [segment.id, segment]));
}

const LIST_MARKER = /^(?:[•·▪●◦‣∙*–—-]|\d{1,2}[.)])\s+/u;

/**
 * The text of kept segments as the CV shows it: lines of one item joined with a space, list markers and
 * soft hyphens removed, runs of spaces collapsed; nothing else changes.
 */
export function verbatim(ids: readonly string[], index: SegmentIndex, separator = ' '): string {
  return ids
    .map((id) => (index.get(id)?.text ?? '').replace(/\xAD/g, '').replace(LIST_MARKER, ''))
    .filter(Boolean)
    .join(separator)
    .replace(/\s+/g, ' ')
    .trim();
}
