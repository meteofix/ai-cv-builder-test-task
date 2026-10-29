import type { Fact } from './facts.js';

/**
 * A bullet may reference only its own position and that position's achievements; a summary sentence any
 * kept fact. An empty list fails: prose without a source is not verifiable.
 */
export function checkReferences(
  item: { factIds: readonly string[] },
  positionId: string | null,
  facts: readonly Fact[],
): boolean {
  if (item.factIds.length === 0) return false;
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return item.factIds.every((id) => {
    const fact = byId.get(id);
    if (!fact) return false;
    if (positionId === null) return true;
    return (
      id === positionId ||
      (fact.kind === 'achievement' && fact.achievement.positionId === positionId)
    );
  });
}

// A number not glued to a letter or digit, with an optional unit before or after it. Metric forms come
// first in the alternation, so `3x` and `10k` are metrics and only bare digits are standalone numbers.
// The lookbehind also skips the tail of a dotted run (`v1.2.3` is one glued token, not the number `2.3`).
const NUMBER_TOKEN =
  /(?<![\p{L}\p{N}]|[\p{L}\p{N}][.,])(?:(?<currencyBefore>[$€£₴])\s?)?(?<plus>\+)?(?<digits>\d+(?:[.,]\d+)*)(?<unit>\s?%|[kKMB]\+?|[x×]|\+|\s?[$€£₴])?(?![\p{L}\p{N}])/gu;

// `03.2019` and `01.03.2019` are one token; their year also stands alone, so "since 2019" is checkable.
// Slash dates (`03/2019`) already split into separate numbers. No other part of a dotted number counts.
const DOTTED_DATE = /^(?:\d{1,2}\.){1,2}(\d{4})$/;

interface NumberTokens {
  metrics: string[];
  standalone: string[];
}

/** Splits a text into metric tokens (with a unit) and standalone numbers; glued tokens like `S3` are skipped. */
export function numberTokens(text: string): NumberTokens {
  const tokens: NumberTokens = { metrics: [], standalone: [] };
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const { currencyBefore, plus, digits, unit } = match.groups ?? {};
    if (digits === undefined) continue;
    if (currencyBefore || plus || unit)
      tokens.metrics.push(match[0].replace(/\s/g, '').toLowerCase());
    else {
      tokens.standalone.push(digits);
      const year = DOTTED_DATE.exec(digits)?.[1];
      if (year) tokens.standalone.push(year);
    }
  }
  return tokens;
}

export interface NumberCheck {
  ok: boolean;
  /** Tokens of the text that were not found; for counters, never logged with the text. */
  unsupported: string[];
}

/**
 * Metrics must equal a metric of the quotes the text references (`40%` does not match `140%`); standalone
 * numbers must equal a standalone number anywhere in the source (`14` does not match `140`).
 */
export function checkNumbers(
  text: string,
  referencedQuotes: readonly string[],
  source: string,
): NumberCheck {
  const own = numberTokens(text);
  const quoted = new Set(referencedQuotes.flatMap((quote) => numberTokens(quote).metrics));
  const inSource = new Set(numberTokens(source).standalone);
  const unsupported = [
    ...own.metrics.filter((token) => !quoted.has(token)),
    ...own.standalone.filter((token) => !inSource.has(token)),
  ];
  return { ok: unsupported.length === 0, unsupported };
}

/** The writer's skill selection, limited to kept skill facts, in the writer's order, each once. */
export function selectSkills(ids: readonly string[], facts: readonly Fact[]): string[] {
  const skills = new Set(facts.filter((fact) => fact.kind === 'skill').map((fact) => fact.id));
  return [...new Set(ids)].filter((id) => skills.has(id));
}
