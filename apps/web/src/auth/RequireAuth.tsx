import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '../api/auth';
import { errorMessage } from '../api/errors';
import { Spinner } from '../components/Icon';

/** Sends a visitor without a session to `/login` and brings them back to the page they asked for. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return (
      <p className="save-status" role="status">
        <Spinner />
        Loading…
      </p>
    );
  }
  if (me.isError) return <p role="alert">{errorMessage(me.error)}</p>;
  if (me.data === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}
