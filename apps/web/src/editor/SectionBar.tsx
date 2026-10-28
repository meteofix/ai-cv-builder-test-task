import type { Question } from '@cv/shared';
import { useState } from 'react';
import { isPending } from './QuestionsBlock';
import { SECTION_IDS } from './showInCv';

const ITEMS = [
  { label: 'Contacts', id: SECTION_IDS.contacts, sections: ['contacts', 'headline'] },
  { label: 'Summary', id: SECTION_IDS.summary, sections: ['summary'] },
  { label: 'Experience', id: SECTION_IDS.experience, sections: ['experience'] },
  { label: 'Education', id: SECTION_IDS.education, sections: ['education'] },
  { label: 'Skills', id: SECTION_IDS.skills, sections: ['skills'] },
  { label: 'More', id: SECTION_IDS.additional, sections: ['additional'] },
] as const;

/** Phone only: a sticky bar of links to the sections, with the number of questions waiting in each. */
export function SectionBar({ questions }: { questions: readonly Question[] }) {
  const [current, setCurrent] = useState<string>(ITEMS[0].id);
  return (
    <nav className="section-bar" aria-label="CV sections">
      {ITEMS.map((item) => {
        const count = questions.filter(
          (question) =>
            isPending(question) &&
            (item.sections as readonly string[]).includes(question.target.section),
        ).length;
        return (
          <a
            key={item.id}
            className="section-bar__link"
            href={`#${item.id}`}
            aria-current={current === item.id ? 'location' : undefined}
            onClick={() => {
              setCurrent(item.id);
            }}
          >
            {item.label}
            {count > 0 ? (
              <span className="section-bar__count">
                {count}
                <span className="sr-only"> {count === 1 ? 'question' : 'questions'}</span>
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}
