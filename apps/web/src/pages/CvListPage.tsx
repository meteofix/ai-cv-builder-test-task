import type { CvListItem, CvState } from '@cv/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCvList, useDeleteCv } from '../api/cvs';
import { errorMessage } from '../api/errors';
import { AppHeader } from '../components/AppHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon, Spinner } from '../components/Icon';

const STATE_BADGES: Record<CvState, { label: string; className: string; busy?: true }> = {
  generating: { label: 'Generating…', className: 'badge badge--info', busy: true },
  updating: { label: 'Updating…', className: 'badge badge--info', busy: true },
  failed: { label: 'Failed', className: 'badge badge--danger' },
  ready: { label: 'Ready', className: 'badge badge--success' },
};

function CvCard({ item, onDelete }: { item: CvListItem; onDelete: () => void }) {
  const badge = STATE_BADGES[item.state];
  return (
    <li className="cv-card">
      <Link className="cv-card__link" to={`/cvs/${item.id}`}>
        <span className="cv-card__role">{item.targetRole}</span>
        <span className="cv-card__name">{item.fullName ?? 'Untitled'}</span>
        <span className="cv-card__badges">
          <span className={badge.className}>
            {badge.busy ? <Spinner /> : null}
            {badge.label}
          </span>
          {item.openQuestions > 0 ? (
            <span className="badge badge--warning">
              {item.openQuestions} open {item.openQuestions === 1 ? 'question' : 'questions'}
            </span>
          ) : null}
        </span>
      </Link>
      <button
        type="button"
        className="btn btn--icon btn--danger cv-card__delete"
        aria-label={`Delete ${item.targetRole}`}
        onClick={onDelete}
      >
        <Icon name="trash" />
      </button>
    </li>
  );
}

export function CvListPage() {
  const list = useCvList();
  const remove = useDeleteCv();
  const [pending, setPending] = useState<CvListItem | null>(null);

  return (
    <>
      <AppHeader
        actions={
          <Link className="btn btn--primary" to="/cvs/new">
            <Icon name="plus" />
            New CV
          </Link>
        }
      />
      <main className="page">
        <h1 className="page__title">Your CVs</h1>
        {list.isPending ? (
          <p className="save-status" role="status">
            <Spinner />
            Loading…
          </p>
        ) : null}
        {list.isError ? <p role="alert">{errorMessage(list.error)}</p> : null}
        {remove.isError ? <p role="alert">{errorMessage(remove.error)}</p> : null}
        {list.data?.length === 0 ? (
          <p className="page__empty">No CVs yet. Create the first one from a PDF or pasted text.</p>
        ) : null}
        {list.data?.length ? (
          <ul className="cv-cards">
            {list.data.map((item) => (
              <CvCard
                key={item.id}
                item={item}
                onDelete={() => {
                  setPending(item);
                }}
              />
            ))}
          </ul>
        ) : null}
      </main>
      <ConfirmDialog
        open={pending !== null}
        title="Delete this CV?"
        message={
          pending ? `“${pending.targetRole}” and its questions will be gone for good.` : undefined
        }
        confirmLabel="Delete"
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={() => {
          if (pending) remove.mutate(pending.id);
          setPending(null);
        }}
      />
    </>
  );
}
