import type { CvSkillGroup } from '@cv/shared';
import { filled } from './text.js';

/** The groups that still have a skill with text, each with only those skills. */
export function visibleSkillGroups(groups: readonly CvSkillGroup[]): CvSkillGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((skill) => filled(skill.name)) }))
    .filter((group) => group.items.length > 0);
}

function SkillList({ items }: { items: readonly { id: string; name: string }[] }) {
  return (
    <ul className="cv-skills">
      {items.map((skill) => (
        <li key={skill.id}>{skill.name}</li>
      ))}
    </ul>
  );
}

/** One group without a title is a plain list; groups print a line each: "Cloud: AWS · GCP". */
export function SkillGroups({ groups }: { groups: readonly CvSkillGroup[] }) {
  const [only] = groups;
  if (groups.length === 1 && only && !filled(only.title)) return <SkillList items={only.items} />;
  return groups.map((group) => {
    // The template adds the colon, so a title typed as "Cloud:" loses its own (the server's
    // `groupTitle` does the same for generated titles).
    const title = group.title?.trim().replace(/:+$/, '').trim() ?? '';
    return (
      <div className="cv-skill-group" key={group.id}>
        {title ? (
          <>
            {/* A real space, so the text reads "Cloud: AWS · GCP" to an ATS too. */}
            <span className="cv-skill-group__title">{title}:</span>{' '}
          </>
        ) : null}
        <SkillList items={group.items} />
      </div>
    );
  });
}
