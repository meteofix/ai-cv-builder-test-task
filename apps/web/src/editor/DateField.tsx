import type { CvDocument } from '@cv/shared';
import { useController, useFormContext } from 'react-hook-form';
import { DatePicker } from './DatePicker';

type DatePath =
  | `experience.${number}.${'start' | 'end'}`
  | `education.${number}.${'start' | 'end'}`
  | `additional.${number}.entries.${number}.${'start' | 'end'}`;

/** A date of the form, kept as `YYYY`, `YYYY-MM` or null. */
export function DateField({
  name,
  label,
  disabled,
}: {
  name: DatePath;
  label: string;
  disabled?: boolean;
}) {
  const { control } = useFormContext<CvDocument>();
  const { field } = useController({ name: name as 'experience.0.start', control });
  return (
    <DatePicker label={label} value={field.value} disabled={disabled} onChange={field.onChange} />
  );
}
