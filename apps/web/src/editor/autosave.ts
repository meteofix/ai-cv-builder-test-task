import type { QueryClient } from '@tanstack/react-query';
import { cvDocumentSchema, type CvDetail, type CvDocument } from '@cv/shared';
import { api } from '../api/client';
import { ApiError, errorMessage } from '../api/errors';
import { queryKeys } from '../api/keys';
import { prepareDocument, serialize } from './prepare';

export type SaveStatus = 'saved' | 'saving' | 'failed' | 'invalid';
export interface SaveSnapshot {
  status: SaveStatus;
  /** A sentence to show above the form (a conflict was resolved, a save was refused). */
  notice: string | null;
}

export const DEBOUNCE_MS = 1000;
/** A failed save is tried again after these pauses; after the last one it waits for the next edit. */
export const RETRY_MS = [1000, 2000, 5000] as const;

const CONFLICT_NOTICE = 'This CV was changed elsewhere. We loaded the latest version.';
const JOB_ACTIVE_NOTICE = 'The CV is being updated, so your last changes were not saved.';

interface Source {
  cvId: string;
  client: QueryClient;
  getValues: () => CvDocument;
  /** Replaces the form with a document from the server without counting it as an edit. */
  reset: (document: CvDocument) => void;
  document: CvDocument;
  version: number;
}

/**
 * Single-flight autosave (decision 012). Whether there is anything to save is a comparison, not a counter:
 * the form as it would be saved now against the form as the server last had it. So typing and then undoing
 * saves nothing, a reload from the server is never an edit, and a save that finishes while the person kept
 * typing is followed by exactly one more, with the version the first one returned. The form is never reset
 * after a successful save, only on a conflict or when an AI job has changed the document.
 */
export class Autosaver {
  private snapshot: SaveSnapshot = { status: 'saved', notice: null };
  private listeners = new Set<() => void>();
  private version: number;
  private synced: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private failures = 0;
  /** Counts the documents adopted from the server: a save that started before one must not overwrite it. */
  private epoch = 0;

  constructor(private readonly source: Source) {
    this.version = source.version;
    this.synced = serialize(source.document);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): SaveSnapshot => this.snapshot;

  currentVersion(): number {
    return this.version;
  }

  /** Something the server does not have yet: unsaved, being saved, or waiting for a retry. */
  hasUnsaved(): boolean {
    return this.running !== null || this.isDirty();
  }

  /** Called on every change of the form. */
  touch(): void {
    if (!this.isDirty()) {
      // Back to what the server has: nothing to save.
      clearTimeout(this.timer);
      if (this.running === null) this.set({ status: 'saved', notice: this.snapshot.notice });
      return;
    }
    this.failures = 0;
    // A field that is still wrong stays "not saved": no flicker through "Saving…" on every keystroke.
    if (!this.isValid()) {
      clearTimeout(this.timer);
      this.set({ status: 'invalid', notice: this.snapshot.notice });
      return;
    }
    this.set({ status: 'saving', notice: this.snapshot.notice });
    this.schedule(DEBOUNCE_MS);
  }

  /** Saves now, and again for whatever was typed meanwhile. Resolves true when the server has everything. */
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
    await this.running;
    return !this.isDirty();
  }

  /** The document came from the server (after a conflict, or an AI job finished): it is the new baseline. */
  adopt(document: CvDocument, version: number, notice: string | null = null): void {
    clearTimeout(this.timer);
    this.epoch += 1;
    this.version = version;
    this.synced = serialize(document);
    this.failures = 0;
    this.source.reset(document);
    this.set({ status: 'saved', notice });
  }

  /** Leaving the page: whatever is waiting for the debounce is sent now. */
  leave(): void {
    clearTimeout(this.timer);
    if (this.isDirty() && this.running === null) void this.flush();
  }

  private isValid(): boolean {
    return cvDocumentSchema.safeParse(prepareDocument(this.source.getValues())).success;
  }

  private isDirty(): boolean {
    return serialize(this.source.getValues()) !== this.synced;
  }

  private set(next: SaveSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private async drain(): Promise<void> {
    while (this.isDirty()) {
      const document = prepareDocument(this.source.getValues());
      // The form shows what is wrong with a field; the save waits until the whole document is valid.
      if (!this.isValid()) {
        this.set({ status: 'invalid', notice: this.snapshot.notice });
        return;
      }
      this.set({ status: 'saving', notice: this.snapshot.notice });
      const epoch = this.epoch;
      try {
        const saved = await api('updateDocument', {
          params: { id: this.source.cvId },
          body: { document, version: this.version },
        });
        // A document adopted from the server while this was in flight is newer than this save.
        if (epoch !== this.epoch) continue;
        this.version = saved.version;
        this.synced = serialize(document);
        this.failures = 0;
        // The cached CV must know the saved state, or coming back to it would show the old one.
        this.source.client.setQueryData<CvDetail>(queryKeys.cv(this.source.cvId), (cv) =>
          cv ? { ...cv, document: saved.document, version: saved.version } : cv,
        );
        this.set({ ...this.snapshot, notice: null });
      } catch (error) {
        if (epoch !== this.epoch) continue;
        await this.fail(error);
        return;
      }
    }
    this.set({ status: 'saved', notice: this.snapshot.notice });
  }

  private async fail(error: unknown): Promise<void> {
    const { client, cvId } = this.source;
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
      try {
        const latest = await client.query({
          queryKey: queryKeys.cv(cvId),
          queryFn: () => api('getCv', { params: { id: cvId } }),
          staleTime: 0,
        });
        if (latest.document) {
          this.adopt(latest.document, latest.version, CONFLICT_NOTICE);
          return;
        }
      } catch {
        // The latest version could not be loaded either: handled below like any failed save.
      }
      this.retryLater(this.snapshot.notice);
      return;
    }
    if (error instanceof ApiError && error.code === 'JOB_ACTIVE') {
      // The editor turns read-only once the CV shows the running job.
      await client.invalidateQueries({ queryKey: queryKeys.cv(cvId) });
      this.set({ status: 'failed', notice: JOB_ACTIVE_NOTICE });
      return;
    }
    // No answer or a server fault may pass by itself; a refusal (400, 403, 404) will not.
    const retryable = error instanceof ApiError && (error.status === 0 || error.status >= 500);
    if (retryable) this.retryLater(this.snapshot.notice);
    else this.set({ status: 'failed', notice: errorMessage(error) });
  }

  private retryLater(notice: string | null): void {
    this.set({ status: 'failed', notice });
    const pause = RETRY_MS[this.failures];
    if (pause === undefined) return;
    this.failures += 1;
    this.schedule(pause);
  }
}
