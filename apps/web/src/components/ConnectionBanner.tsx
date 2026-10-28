import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnectionLost } from '../api/connection';
import { Icon } from './Icon';

const PROBE_MS = 5000;

/** Shown while the browser is offline or the API cannot be reached; edits stay in the form until it is back. */
export function ConnectionBanner() {
  const lost = useConnectionLost();
  const client = useQueryClient();

  // The first request that gets an answer clears the banner, so ask the screen's own queries again.
  useEffect(() => {
    if (!lost) return;
    const timer = setInterval(() => {
      void client.refetchQueries({ type: 'active' });
    }, PROBE_MS);
    return () => {
      clearInterval(timer);
    };
  }, [lost, client]);

  if (!lost) return null;
  return (
    <div className="alert alert--danger" role="alert">
      <div className="alert__body">
        <Icon name="alert" className="alert__icon" />
        <p className="alert__message">Connection lost. Your changes stay on this page.</p>
      </div>
    </div>
  );
}
