import { LIMITS, type Answer, type Question } from '@cv/shared';
import { useId, useState } from 'react';
import { useAnswerQuestion, useDismissQuestion } from '../api/questions';
import { errorMessage } from '../api/errors';
import { Spinner } from '../components/Icon';
import { DatePicker } from './DatePicker';
import { formatRange } from './dates';
import { showInCv } from './showInCv';

interface QuestionCardProps {
  cvId: string;
  question: Question;
  /** Saves the pending edits; resolves true when the server has them all. */
  flush: () => Promise<boolean>;
}

const NOT_SAVED =
  'Your changes are not saved yet. Wait for "Saved" or fix the highlighted field, then answer.';

/** An open question (or one whose answer could not be applied), with the inputs for its answer. */
function QuestionForm({ cvId, question, flush }: QuestionCardProps) {
  const id = useId();
  const answer = useAnswerQuestion(cvId);
  const dismiss = useDismissQuestion(cvId);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [current, setCurrent] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  // From the click until the request is sent the pending autosave is flushed: no second click meanwhile.
  const [busy, setBusy] = useState(false);

  const given: Answer | null =
    question.answerType === 'dates'
      ? start || end || current
        ? { type: 'dates', start, end: current ? null : end, current }
        : null
      : text.trim()
        ? { type: 'text', text: text.trim() }
        : null;

  const submit = async () => {
    if (!given) return;
    setNote(null);
    setBusy(true);
    // The answer rewrites part of the document on the server: what was typed must be there first.
    const saved = await flush();
    setBusy(false);
    if (!saved) {
      setNote(NOT_SAVED);
      return;
    }
    answer.mutate({ question, answer: given });
  };

  const error =
    note ??
    (answer.isError ? errorMessage(answer.error) : null) ??
    (dismiss.isError ? errorMessage(dismiss.error) : null);

  return (
    <li className="question-card" aria-label={question.prompt}>
      {question.applyStatus === 'failed' ? (
        <div className="question-card__status">
          <span className="badge badge--danger">Could not apply</span>
        </div>
      ) : null}
      {question.answerType === 'text' ? (
        <label className="question-card__prompt" htmlFor={id}>
          {question.prompt}
        </label>
      ) : (
        <p className="question-card__prompt">{question.prompt}</p>
      )}
      {question.context ? (
        <blockquote className="question-card__context">{question.context}</blockquote>
      ) : null}
      {question.answerType === 'dates' ? (
        <div className="date-range">
          <DatePicker label="Start" value={start} onChange={setStart} />
          <DatePicker label="End" value={end} onChange={setEnd} disabled={current} />
          {/* The document stores no "Present" for education. */}
          {question.target.section === 'education' ? null : (
            <label className="checkbox date-range__present">
              <input
                type="checkbox"
                checked={current}
                onChange={(event) => {
                  setCurrent(event.target.checked);
                  if (event.target.checked) setEnd(null);
                }}
              />
              Present
            </label>
          )}
        </div>
      ) : (
        <textarea
          id={id}
          className="textarea"
          rows={3}
          maxLength={LIMITS.maxAnswerChars}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      )}
      {question.applyStatus === 'failed' && question.applyNote ? (
        <p className="question-card__note">{question.applyNote}</p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="question-card__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!given || busy || answer.isPending}
          onClick={() => void submit()}
        >
          {busy || answer.isPending ? <Spinner /> : null}
          Answer
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={dismiss.isPending}
          onClick={() => {
            dismiss.mutate(question);
          }}
        >
          Dismiss
        </button>
        <button
          type="button"
          className="btn btn--link question-card__show"
          onClick={() => {
            showInCv(question.target);
          }}
        >
          Show in CV
        </button>
      </div>
    </li>
  );
}

function answerText(answer: Answer | null): string {
  if (!answer) return '';
  return answer.type === 'text'
    ? answer.text
    : formatRange(answer.start, answer.end, answer.current);
}

/** A question that has been answered: still applying, applied, or applied in part. */
function AnsweredCard({ question }: { question: Question }) {
  const applying = question.applyStatus === 'applying';
  let badge = null;
  if (question.applyStatus === 'applied')
    badge = <span className="badge badge--success">Applied</span>;
  if (question.applyStatus === 'partial') {
    badge = <span className="badge badge--warning">Partially applied</span>;
  }
  return (
    <li
      className={`question-card ${applying ? 'question-card--updating' : 'question-card--answered'}`}
      aria-busy={applying || undefined}
      aria-label={question.prompt}
    >
      <div className="question-card__status">
        {applying ? (
          <span className="badge badge--info" role="status">
            <Spinner />
            Updating…
          </span>
        ) : (
          badge
        )}
      </div>
      <p className="question-card__prompt">{question.prompt}</p>
      <p className="question-card__answer">
        <span className="question-card__answer-label">Your answer:</span>{' '}
        {answerText(question.answer)}
      </p>
      {question.applyNote ? <p className="question-card__note">{question.applyNote}</p> : null}
    </li>
  );
}

export function QuestionCard(props: QuestionCardProps) {
  const { question } = props;
  if (question.status === 'dismissed') return null;
  // An answer that could not be applied offers the form again: the API accepts a new answer to it.
  if (question.status === 'open' || question.applyStatus === 'failed') {
    return <QuestionForm {...props} />;
  }
  return <AnsweredCard question={question} />;
}
