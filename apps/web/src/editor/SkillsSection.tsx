import { LIMITS, splitList, type CvDocument, type CvSkill } from '@cv/shared';
import { useState, type ReactNode } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { AddButton, FieldError } from './fields';
import { ItemGroup } from './ItemGroup';
import { newId } from './prepare';

const names = (items: readonly CvSkill[]) => items.map((skill) => skill.name).join(', ');

/** The first message in a branch of form errors: a skill's name, or the list of one group. */
function firstMessage(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  if ('message' in error && typeof error.message === 'string') return error.message;
  for (const [key, value] of Object.entries(error)) {
    // `ref` is the input element, not an error.
    const found = key === 'ref' ? undefined : firstMessage(value);
    if (found) return found;
  }
  return undefined;
}

/**
 * The skills a line stands for. A name spelled exactly as before stays the same skill (its id and its
 * provenance); a name being retyped keeps the id of the skill at its place, so ids do not churn with every
 * keystroke, but never that skill's provenance. A name repeated in the line is one skill.
 */
export function skillsOf(line: string, before: readonly CvSkill[]): CvSkill[] {
  const unused = new Map(before.map((skill) => [skill.id, skill]));
  const seen = new Set<string>();
  const next: CvSkill[] = [];
  splitList(line).forEach((name, index) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const same = [...unused.values()].find((skill) => skill.name === name);
    const atPlace = before[index];
    const reused = same ?? (atPlace && unused.has(atPlace.id) ? atPlace : undefined);
    if (reused) unused.delete(reused.id);
    next.push(reused?.name === name ? reused : { id: reused?.id ?? newId(), name });
  });
  return next;
}

/**
 * One group of skills: the shared group block with its skills as one comma-separated line. The line is the
 * person's own text while they type ("React, " must not lose its comma) and becomes skills on every change.
 */
function SkillGroup({ index, onRemove }: { index: number; onRemove: () => void }) {
  const { setValue, control, formState } = useFormContext<CvDocument>();
  const items = useWatch({ control, name: `skills.${index}.items` });
  // The person's own line while they type; otherwise the skills as the form holds them (an answer or
  // "Add" may change them).
  const [line, setLine] = useState<string | null>(null);
  const message = firstMessage(formState.errors.skills?.[index]?.items);
  const errorId = `skills-${index}-error`;
  const n = index + 1;

  return (
    <ItemGroup
      label={`Group ${n}`}
      titleName={`skills.${index}.title`}
      titlePlaceholder="Optional, for example Cloud"
      onRemove={onRemove}
    >
      <label className="field">
        <span className="field__label">Group {n} skills, separated by commas</span>
        <textarea
          className="textarea"
          rows={2}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errorId : undefined}
          value={line ?? names(items)}
          onFocus={() => {
            setLine(names(items));
          }}
          onBlur={() => {
            setLine(null);
          }}
          onChange={(event) => {
            setLine(event.target.value);
            setValue(`skills.${index}.items`, skillsOf(event.target.value, items), {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
        />
        <FieldError id={errorId} message={message} />
      </label>
    </ItemGroup>
  );
}

export function SkillsSection({ updating }: { updating?: ReactNode }) {
  const { control, formState } = useFormContext<CvDocument>();
  const groups = useFieldArray({ control, name: 'skills', keyName: 'key' });
  const full = groups.fields.length >= LIMITS.maxSkillGroups;
  // The cap of all groups together is reported on the list, not on one group.
  const total = formState.errors.skills?.root?.message ?? formState.errors.skills?.message;

  return (
    <section className="form-section" id="section-skills">
      <div className="form-section__head">
        <h2 className="form-section__title">Skills</h2>
        {updating}
      </div>
      {groups.fields.map((group, index) => (
        <SkillGroup
          key={group.key}
          index={index}
          onRemove={() => {
            groups.remove(index);
          }}
        />
      ))}
      <FieldError message={total} />
      <AddButton
        disabled={full}
        onClick={() => {
          groups.append({ id: newId(), title: null, items: [] });
        }}
      >
        Add group
      </AddButton>
    </section>
  );
}
