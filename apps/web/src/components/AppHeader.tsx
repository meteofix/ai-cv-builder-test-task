import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLogout } from '../api/auth';
import { errorMessage } from '../api/errors';
import { Icon } from './Icon';

interface AppHeaderProps {
  /** The target role, shown as the page title next to the brand. */
  role?: string;
  /** e.g. the "CV language" badge, shown beside the brand. */
  badge?: ReactNode;
  /** Buttons placed before "Log out" (save status, Download PDF). */
  actions?: ReactNode;
  /** The phone layout does not stick to the top. */
  isStatic?: boolean;
}

export function AppHeader({ role, badge, actions, isStatic = false }: AppHeaderProps) {
  const logout = useLogout();
  const navigate = useNavigate();
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
          className="btn btn--ghost"
          disabled={logout.isPending}
          onClick={() => {
            // Straight to a clean /login: the route guard would add the page to come back to.
            logout.mutate(undefined, { onSuccess: () => void navigate('/login') });
          }}
        >
          <Icon name="logout" />
          Log out
        </button>
      </div>
    </header>
  );
}
