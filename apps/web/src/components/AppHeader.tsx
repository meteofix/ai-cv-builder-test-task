import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLogout } from '../api/auth';
import { errorMessage } from '../api/errors';
import { finishSession } from '../api/query-client';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';

interface AppHeaderProps {
  /** The target role, shown as the page title next to the brand. */
  role?: string;
  /** e.g. the "CV language" badge, shown beside the brand. */
  badge?: ReactNode;
  /** Buttons placed before "Log out" (save status, Download PDF). */
  actions?: ReactNode;
  /** The phone layout does not stick to the top and keeps only the icon of "Log out". */
  isStatic?: boolean;
  /** Runs before "Log out" asks the server: resolves false when edits could not be saved (the person is asked). */
  beforeLogout?: () => Promise<boolean>;
}

export function AppHeader({
  role,
  badge,
  actions,
  isStatic = false,
  beforeLogout,
}: AppHeaderProps) {
  const logout = useLogout();
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);

  const logOut = () => {
    logout.mutate(undefined, {
      // The route guard sends the person to /login: no explicit navigation, so nothing can race it.
      onSuccess: () => {
        finishSession(client, true);
      },
    });
  };

  return (
    <header className={isStatic ? 'app-header app-header--static' : 'app-header'}>
      <div className="app-header__brand">
        <Link className="app-header__name" to="/">
          CV Builder
        </Link>
        {badge}
      </div>
      {role ? <h1 className="app-header__role">{role}</h1> : null}
      <div className="app-header__actions">
        {actions}
        {logout.isError ? (
          <span className="save-status save-status--failed" role="alert">
            {errorMessage(logout.error)}
          </span>
        ) : null}
        <button
          type="button"
          className={isStatic ? 'btn btn--icon btn--ghost' : 'btn btn--ghost'}
          aria-label={isStatic ? 'Log out' : undefined}
          disabled={logout.isPending}
          onClick={() => {
            void (beforeLogout ? beforeLogout() : Promise.resolve(true)).then((saved) => {
              if (saved) logOut();
              else setAsking(true);
            });
          }}
        >
          <Icon name="logout" />
          {isStatic ? null : 'Log out'}
        </button>
      </div>
      <ConfirmDialog
        open={asking}
        title="Log out without saving?"
        message="Your latest changes could not be saved."
        confirmLabel="Log out"
        onCancel={() => {
          setAsking(false);
        }}
        onConfirm={() => {
          setAsking(false);
          logOut();
        }}
      />
    </header>
  );
}
