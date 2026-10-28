import { useQueryClient } from '@tanstack/react-query';
import type { CvDocument } from '@cv/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Autosaver } from './autosave';

interface Options {
  cvId: string;
  form: UseFormReturn<CvDocument>;
  document: CvDocument;
  version: number;
}

export function useAutosave({ cvId, form, document, version }: Options) {
  const client = useQueryClient();
  const [saver] = useState(
    () =>
      new Autosaver({
        cvId,
        client,
        document,
        version,
        getValues: () => form.getValues(),
        reset: (next) => {
          form.reset(next);
        },
      }),
  );
  const snapshot = useSyncExternalStore(saver.subscribe, saver.getSnapshot);

  useEffect(() => {
    const subscription = form.watch(() => {
      saver.touch();
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.hasUnsaved()) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('beforeunload', warn);
      saver.leave();
    };
  }, [form, saver]);

  return { saver, ...snapshot };
}
