import { LIMITS, type CvDocument } from '@cv/shared';
import type { FocusEvent, ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { AddButton, FieldError, IconButton } from './fields';

/** `linkedin.com/in/x` → `https://linkedin.com/in/x`; anything that already has a scheme is left alone. */
export function normalizeLink(value: string): string {
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

export function ContactsSection({ updating }: { updating?: ReactNode }) {
  const {
    register,
    setValue,
    control,
    formState: { errors },
  } = useFormContext<CvDocument>();
  const links = useWatch({ control, name: 'contacts.links' });
  const setLinks = (next: string[], validate: boolean) => {
    // A new row is empty and not an error until the person has typed something.
    setValue('contacts.links', next, { shouldDirty: true, shouldValidate: validate });
  };

  return (
    <section className="form-section" id="section-contacts" aria-labelledby="contacts-title">
      <div className="form-section__head">
        <h2 className="form-section__title" id="contacts-title">
          Contacts
        </h2>
        {updating}
      </div>
      <div className="field-grid">
        <label className="field field-grid__full">
          <span className="field__label">Full name</span>
          <input
            className="input"
            autoComplete="name"
            maxLength={LIMITS.maxFieldChars}
            {...register('contacts.fullName')}
          />
        </label>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            id="field-email"
            className="input"
            type="email"
            autoComplete="email"
            maxLength={LIMITS.maxFieldChars}
            {...register('contacts.email')}
          />
        </label>
        <label className="field">
          <span className="field__label">Phone</span>
          <input
            id="field-phone"
            className="input"
            type="tel"
            autoComplete="tel"
            maxLength={LIMITS.maxFieldChars}
            {...register('contacts.phone')}
          />
        </label>
        <label className="field field-grid__full">
          <span className="field__label">Location</span>
          <input
            className="input"
            maxLength={LIMITS.maxFieldChars}
            {...register('contacts.location')}
          />
        </label>
      </div>
      <div className="field" role="group" aria-label="Links">
        <span className="field__label" aria-hidden="true">
          Links
        </span>
        <ul className="line-list">
          {links.map((_link, index) => {
            const error = errors.contacts?.links?.[index]?.message;
            return (
              // Index keys: the inputs are registered by position and the list is replaced as a whole.
              <li key={index}>
                <div className="line-row">
                  <input
                    className="input"
                    type="url"
                    aria-label={`Link ${index + 1}`}
                    aria-invalid={error ? true : undefined}
                    maxLength={LIMITS.maxFieldChars}
                    {...register(`contacts.links.${index}`, {
                      onBlur: (event: FocusEvent<HTMLInputElement>) => {
                        const fixed = normalizeLink(event.target.value);
                        if (fixed !== event.target.value) {
                          setValue(`contacts.links.${index}`, fixed, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }
                      },
                    })}
                  />
                  <IconButton
                    label="Remove link"
                    icon="close"
                    onClick={() => {
                      setLinks(
                        links.filter((_value, i) => i !== index),
                        true,
                      );
                    }}
                  />
                </div>
                <FieldError message={error} />
              </li>
            );
          })}
        </ul>
        <AddButton
          disabled={links.length >= LIMITS.maxLinks}
          onClick={() => {
            setLinks([...links, ''], false);
          }}
        >
          Add link
        </AddButton>
      </div>
    </section>
  );
}
