import { Component, type ReactNode } from 'react';
import { Icon } from './Icon';

/** What the person sees instead of a blank screen; the error itself can hold CV text, so it is not shown. */
export function CrashMessage() {
  return (
    <main className="page">
      <div className="alert alert--danger" role="alert">
        <div className="alert__body">
          <Icon name="alert" className="alert__icon" />
          <p className="alert__message">
            Something went wrong on this page. Your saved changes are safe; reload to continue.
          </p>
        </div>
      </div>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload
      </button>
    </main>
  );
}

/** Keeps a render error in one part of the screen from unmounting the whole app. */
export class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  override render() {
    return this.state.crashed ? <CrashMessage /> : this.props.children;
  }
}
