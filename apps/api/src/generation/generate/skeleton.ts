import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  linkSchema,
  type CvAdditionalSection,
  type CvDocument,
  type CvPosition,
  type Locale,
} from '@cv/shared';
import { findQuote, type Fact } from '../../grounding/index.js';
import type { ProseItem } from './schemas.js';

type FactOf<K extends Fact['kind']> = Extract<Fact, { kind: K }>;

/** The writer's part of the document, after every check; absent in the draft. */
export interface Prose {
  summary: readonly ProseItem[];
  bullets: ReadonlyMap<string, readonly ProseItem[]>;
  /** Selected skill fact ids; null shows every skill. */
  skills: readonly string[] | null;
}

export interface SkeletonInput {
  source: string;
  facts: readonly Fact[];
  targetRole: string;
  locale: Locale;
  prose?: Prose;
}

const ADDITIONAL_FALLBACK: Record<Locale, string> = {
  en: 'Additional information',
  uk: 'Додаткова інформація',
};

/**
 * The CV built from facts (what does not fit `LIMITS` is left out and shows as unused in "Not in your
 * CV"): everything structural is copied from verified facts by the server, never from
 * a model. The draft (no prose) and the finished document come from this one function, so ids and
 * structure are the same in both and in question targets.
 */
export function buildSkeleton(input: SkeletonInput): CvDocument {
  const facts = input.facts;
  const of = <K extends Fact['kind']>(kind: K) =>
    facts.filter((fact): fact is FactOf<K> => fact.kind === kind);
  const prose = input.prose;

  // Experience always follows the source (decision 033): facts come renumbered in source order
  // (grounding.md §2), and the writer picks bullets, not the order of jobs. Do not sort them here.
  const positions = of('position');
  const experience = positions.slice(0, LIMITS.maxExperience).map((fact): CvPosition => {
    const { company, title, location, start, end, current } = fact.position;
    return {
      id: fact.id,
      factId: fact.id,
      company,
      title,
      ...(location ? { location } : {}),
      start,
      end: current ? null : end,
      current,
      bullets: (prose?.bullets.get(fact.id) ?? []).map(({ id, text, factIds }) => ({
        id,
        text,
        factIds: [...factIds],
      })),
    };
  });

  const education = of('education')
    .slice(0, LIMITS.maxEducation)
    .map((fact) => {
      const { institution, degree, start, end } = fact.education;
      return {
        id: fact.id,
        factId: fact.id,
        institution,
        ...(degree ? { degree } : {}),
        start,
        end,
      };
    });

  const skillFacts = of('skill');
  const selected = prose?.skills
    ? prose.skills.flatMap((id) => skillFacts.filter((fact) => fact.id === id))
    : skillFacts;
  const skills = selected.slice(0, LIMITS.maxSkills).map((fact) => ({
    id: fact.id,
    name: fact.skill.name,
    factId: fact.id,
  }));

  return {
    locale: input.locale,
    contacts: contacts(of('contact')),
    headline: input.targetRole.slice(0, LIMITS.maxFieldChars),
    summary: summary(prose?.summary ?? []),
    experience,
    education,
    skills,
    additional: additional(of('other'), input),
  };
}

function contacts(facts: FactOf<'contact'>[]): CvDocument['contacts'] {
  const first = (field: FactOf<'contact'>['contact']['field']) =>
    facts.find((fact) => fact.contact.field === field)?.contact.value ?? '';
  const links = facts
    .filter((fact) => fact.contact.field === 'link')
    .map((fact) => withScheme(fact.contact.value))
    .filter((link) => linkSchema.safeParse(link).success);
  return {
    fullName: first('fullName'),
    email: first('email'),
    phone: first('phone'),
    location: first('location'),
    links: [...new Set(links)].slice(0, LIMITS.maxLinks),
  };
}

/** `github.com/iryna` is a link without a scheme; a scheme the schema does not allow stays and fails it. */
export function withScheme(value: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

/** Sentences in the writer's order, as many as fit the summary limit. */
export function summary(sentences: readonly ProseItem[]): CvDocument['summary'] {
  let text = '';
  const factIds = new Set<string>();
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence.text}` : sentence.text;
    if (next.length > LIMITS.maxSummaryChars) break;
    text = next;
    for (const id of sentence.factIds) factIds.add(id);
  }
  return { text, factIds: [...factIds].slice(0, 20) };
}

/** Extra sections copied verbatim, one item per fact, grouped by their source heading in source order. */
function additional(facts: FactOf<'other'>[], input: SkeletonInput): CvAdditionalSection[] {
  const sections = new Map<string, FactOf<'other'>[]>();
  for (const fact of facts) {
    if (verbatim(input.source, fact).length > LIMITS.maxTextChars) continue;
    const heading = fact.other.section.trim();
    sections.set(heading, [...(sections.get(heading) ?? []), fact]);
  }
  const result: CvAdditionalSection[] = [];
  for (const [heading, items] of sections) {
    if (result.length === LIMITS.maxAdditionalSections) break;
    result.push({
      id: randomUUID(),
      title:
        heading && findQuote(input.source, heading) ? heading : ADDITIONAL_FALLBACK[input.locale],
      items: items.slice(0, LIMITS.maxAdditionalItems).map((fact) => ({
        id: fact.id,
        text: verbatim(input.source, fact),
        factIds: [fact.id],
      })),
    });
  }
  return result;
}

/** The source text at the fact's span: the user's own words, not the model's copy of them. */
export function verbatim(source: string, fact: Fact): string {
  return source.slice(fact.span[0], fact.span[1]).replace(/\s+/g, ' ').trim();
}
