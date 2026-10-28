import { LIMITS, type CvDocument } from '@cv/shared';
import { useState, type ReactNode } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Icon } from '../components/Icon';
import { newId } from './prepare';

export function SkillsSection({ updating }: { updating?: ReactNode }) {
  const { control } = useFormContext<CvDocument>();
  const { fields, append, remove } = useFieldArray({ control, name: 'skills', keyName: 'key' });
  const [draft, setDraft] = useState('');
  const full = fields.length >= LIMITS.maxSkills;

  const add = () => {
    const name = draft.replace(/,+$/, '').trim();
    setDraft('');
    const known = fields.some((skill) => skill.name.toLowerCase() === name.toLowerCase());
    if (name && !known && !full) append({ id: newId(), name });
  };

  return (
    <section className="form-section" id="section-skills">
      <div className="form-section__head">
        <h2 className="form-section__title">
          <label htmlFor="field-skills">Skills</label>
        </h2>
        {updating}
      </div>
      <div className="tag-input">
        <ul className="tag-input__tags">
          {fields.map((skill, index) => (
            <li className="tag" key={skill.key}>
              {skill.name}
              <button
                type="button"
                className="tag__remove"
                aria-label={`Remove ${skill.name}`}
                onClick={() => {
                  remove(index);
                }}
              >
                <Icon name="close" small />
              </button>
            </li>
          ))}
        </ul>
        <input
          id="field-skills"
          className="tag-input__field"
          placeholder="Add skill"
          maxLength={LIMITS.maxFieldChars}
          disabled={full}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter that confirms an IME candidate is not "add".
            if ((event.key === 'Enter' || event.key === ',') && !event.nativeEvent.isComposing) {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
    </section>
  );
}
