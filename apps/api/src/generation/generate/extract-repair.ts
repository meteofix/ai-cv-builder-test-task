import type { DroppedFact, ExtractedFact } from '../../grounding/index.js';
import { JobError, OPTIONAL_REQUEST_FAILURES } from '../job-errors.js';
import type { AskExtractor } from './extract-step.js';
import { REPAIR_SYSTEM, repairInput, type FactToFix } from './prompts.js';
import { repairOutputSchema, type RepairOutput } from './schemas.js';

/**
 * The reasons a second look can cure: the quote was not copied exactly, or a value is not in it. A fact
 * dropped as an instruction or a duplicate is never offered back to the model.
 */
const REPAIRABLE = new Set<DroppedFact['reason']>(['quote_not_found', 'field_not_in_quote']);

/**
 * One more request for the facts the checks dropped as misquoted (docs/specs/generation.md §3.1): the
 * extractor sees each with the reason and may only give a new quote, or a new value for a skill or
 * contact. It cannot add a fact or change what one says; the patched facts are verified again by the
 * caller like the rest. Returns the facts unchanged, without a request, when none is repairable.
 */
export async function repairFacts(
  text: string,
  facts: readonly ExtractedFact[],
  dropped: readonly DroppedFact[],
  ask: AskExtractor,
): Promise<{ facts: ExtractedFact[]; asked: string[] }> {
  const reasons = new Map(
    dropped.filter((fact) => REPAIRABLE.has(fact.reason)).map((fact) => [fact.id, fact.reason]),
  );
  const toFix = facts.filter((fact) => reasons.has(fact.id));
  if (toFix.length === 0) return { facts: [...facts], asked: [] };
  const asked = toFix.map((fact) => fact.id);
  let fixes: RepairOutput['fixes'];
  try {
    ({ fixes } = await ask({
      system: REPAIR_SYSTEM,
      input: repairInput(
        text,
        toFix.map((fact) => describe(fact, reasons.get(fact.id))),
      ),
      schema: repairOutputSchema,
    }));
  } catch (error) {
    if (error instanceof JobError && OPTIONAL_REQUEST_FAILURES.has(error.code))
      return { facts: [...facts], asked };
    throw error;
  }
  // Only the facts the server chose can change, each once: the model cannot pick what to rewrite.
  const byKey = new Map<string, (typeof fixes)[number]>();
  for (const fix of fixes) if (reasons.has(fix.key) && !byKey.has(fix.key)) byKey.set(fix.key, fix);
  return {
    facts: facts.map((fact) => {
      const fix = reasons.has(fact.id) ? byKey.get(fact.id) : undefined;
      return fix?.quote ? patched(fact, fix.quote, fix.value) : fact;
    }),
    asked,
  };
}

function valueOf(fact: ExtractedFact): string | null {
  if (fact.kind === 'skill') return fact.skill.name;
  if (fact.kind === 'contact') return fact.contact.value;
  return null;
}

function describe(fact: ExtractedFact, reason: DroppedFact['reason'] | undefined): FactToFix {
  const value = valueOf(fact);
  return {
    key: fact.id,
    kind: fact.kind,
    quote: fact.quote,
    value,
    problem:
      reason === 'field_not_in_quote'
        ? `The value "${value ?? ''}" is not in this quote as a whole value. Give a quote that contains it, or repeat the quote with the value exactly as it writes it.`
        : 'This quote is not in the CV text. Copy the exact text the fact stands for.',
  };
}

/** Only the quote and a skill's or contact's value change; every other field stays the model's first. */
function patched(fact: ExtractedFact, quote: string, value: string | null): ExtractedFact {
  if (fact.kind === 'skill' && value) return { ...fact, quote, skill: { name: value } };
  if (fact.kind === 'contact' && value) {
    return { ...fact, quote, contact: { ...fact.contact, value } };
  }
  return { ...fact, quote };
}
