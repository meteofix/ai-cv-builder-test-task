import type { CvDocument, Question } from '@cv/shared';
import { useFormContext, useWatch } from 'react-hook-form';
import { Icon } from '../components/Icon';
import { QuestionCard } from './QuestionCard';

/** A question the person still has to deal with: open, or answered but not applied. */
export function isPending(question: Question): boolean {
  return question.status === 'open' || question.applyStatus === 'failed';
}

function focusField(id: string) {
  document.getElementById(id)?.focus();
}

interface QuestionsBlockProps {
  cvId: string;
  questions: readonly Question[];
  flush: () => Promise<boolean>;
  /** The phone layout: tighter spacing and two-line contexts. */
  compact?: boolean;
}

/**
 * "Needs clarification": the questions of the generation, plus two items computed here from the live form
 * (a CV with no email or phone) that only move the focus to the field; they never call the API.
 */
export function QuestionsBlock({ cvId, questions, flush, compact = false }: QuestionsBlockProps) {
  const { control } = useFormContext<CvDocument>();
  const [email, phone] = useWatch({ control, name: ['contacts.email', 'contacts.phone'] });
  const visible = questions.filter((question) => question.status !== 'dismissed');
  const computed = [
    ...(email.trim() ? [] : [{ label: 'Add email', field: 'field-email' }]),
    ...(phone.trim() ? [] : [{ label: 'Add phone', field: 'field-phone' }]),
  ];
  if (visible.length === 0 && computed.length === 0) return null;

  const count = visible.filter(isPending).length + computed.length;
  return (
    <section
      className={compact ? 'clarify clarify--compact' : 'clarify'}
      id="section-clarify"
      aria-labelledby="clarify-title"
    >
      <h2 className="clarify__title" id="clarify-title">
        <span className="clarify__dot" aria-hidden="true" />
        {count > 0 ? `Needs clarification · ${count}` : 'Questions'}
      </h2>
      <ol className="clarify__list">
        {visible.map((question) => (
          <QuestionCard key={question.id} cvId={cvId} question={question} flush={flush} />
        ))}
        {computed.map(({ label, field }) => (
          <li className="question-card question-card--computed" key={field}>
            <button
              type="button"
              className="question-card__jump"
              onClick={() => {
                focusField(field);
              }}
            >
              <span>{label}</span>
              <Icon name="arrow" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
