import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../api/auth';
import { queryKeys } from '../api/keys';
import { errorMessage } from '../api/errors';
import { Spinner } from '../components/Icon';

/** Sends a visitor without a session to `/login` and brings them back to the page they asked for. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  const leftOnPurpose = useQueryClient().getQueryData(queryKeys.leftOnPurpose) === true;
  if (me.isPending) {
    return (
      <p className="save-status" role="status">
        <Spinner />
        Loading…
      </p>
    );
  }
  // A failed refresh (the `me` query invalidated while the API is down) does not end the session: with a
  // known user the page, and its unsaved form, stays. Only a first load that failed shows the error.
  if (me.data === undefined) return <p role="alert">{errorMessage(me.error)}</p>;
  if (me.data === null) {
    // After a logout the person asked for there is no page to come back to.
    return (
      <Navigate
        to="/login"
        replace
        state={leftOnPurpose ? undefined : { from: location.pathname + location.search }}
      />
    );
  }
  return children;
}
