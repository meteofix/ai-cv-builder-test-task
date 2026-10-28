import { useState } from 'react';
import { joinDate, MONTH_NAMES, splitDate, yearOptions } from './dates';

interface DatePickerProps {
  label: string;
  /** `YYYY`, `YYYY-MM` or nothing. */
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

/** A month (with "—") and a year; the month alone is not a date, so it waits here until a year is chosen. */
export function DatePicker({ label, value, onChange, disabled = false }: DatePickerProps) {
  const stored = splitDate(value);
  const [pendingMonth, setPendingMonth] = useState('');
  const month = stored.year ? stored.month : pendingMonth;

  return (
    <div className="date-field" role="group" aria-label={`${label} date`}>
      <span className="field__label" aria-hidden="true">
        {label}
      </span>
      <div className="date-field__selects">
        <label className="field">
          <span className="sr-only">{label} month</span>
          <select
            className="select"
            disabled={disabled}
            value={month}
            onChange={(event) => {
              if (stored.year) onChange(joinDate(event.target.value, stored.year));
              else setPendingMonth(event.target.value);
            }}
          >
            <option value="">—</option>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={String(index + 1).padStart(2, '0')}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">{label} year</span>
          <select
            className="select"
            disabled={disabled}
            value={stored.year}
            onChange={(event) => {
              onChange(joinDate(month, event.target.value));
              setPendingMonth('');
            }}
          >
            <option value="">Year</option>
            {yearOptions(stored.year).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
