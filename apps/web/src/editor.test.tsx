import { bulletsOf, type CvDocument, type Job, type UpdateDocumentRequest } from '@cv/shared';
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorDocument } from './test/fixtures';
import { CV_ID, cvDetail, job, mockRoute, problem, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

afterEach(() => {
  vi.useRealTimers();
});

/** The editor loads on real timers (`findBy*` waits on them); timing starts only after it is on the screen. */
function startFakeClock() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
}

interface Mount {
  doc?: CvDocument;
  version?: number;
  job?: Job;
  /** Called for every PUT; the default answers with the next version. */
  onPut?: (request: UpdateDocumentRequest, count: number) => Promise<void> | void;
}

async function mountEditor({ doc = editorDocument(), version = 3, job: cvJob, onPut }: Mount = {}) {
  const puts: UpdateDocumentRequest[] = [];
  server.use(
    mockRoute('me', () => USER),
    mockRoute('getCv', () => cvDetail({ document: doc, version, job: cvJob ?? job() })),
    mockRoute('updateDocument', async ({ body }) => {
      const request = body as UpdateDocumentRequest;
      puts.push(request);
      await onPut?.(request, puts.length);
      return { document: request.document, version: request.version + 1 };
    }),
  );
  startFakeClock();
  const view = renderApp(`/cvs/${CV_ID}`);
  await screen.findByLabelText('Headline');
  return { ...view, puts };
}

function card(text: string): HTMLElement {
  const found = screen.getByText(text, { selector: '.entry-card__org' }).closest('details');
  if (!found) throw new Error(`No card for ${text}`);
  return found;
}

function previewText(): string {
  return document.querySelector('iframe')?.contentDocument?.body.textContent ?? '';
}

describe('editor', () => {
  it('shows every field of the document, the language label and the preview', async () => {
    await mountEditor();

    expect(screen.getByLabelText('Full name')).toHaveValue('Iryna Kovalenko');
    expect(screen.getByLabelText('Headline')).toHaveValue('Senior Full-Stack Engineer');
    expect(screen.getByLabelText('Summary')).toHaveValue(
      'Full-stack engineer with 7 years of experience.',
    );
    expect(screen.getByText('CV language: English')).toBeInTheDocument();
    expect(within(card('Northwind Learning')).getByLabelText('Bullet 1')).toHaveValue(
      'Led the migration of the web checkout to Next.js 14.',
    );
    expect(screen.getByDisplayValue('Languages')).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(previewText()).toContain('Iryna Kovalenko');
    });
  });

  it('WEB-7 — typing during a save is neither lost nor a conflict', async () => {
    let release: () => void = vi.fn();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user, puts } = await mountEditor({
      onPut: async (_request, count) => {
        if (count === 1) await gate;
      },
    });
    const headline = screen.getByLabelText('Headline');

    await user.type(headline, 'A');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]?.version).toBe(3);

    await user.type(headline, 'B');
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1);
    expect(headline).toHaveValue('Senior Full-Stack EngineerAB');

    release();
    await vi.waitFor(() => {
      expect(puts).toHaveLength(2);
    });
    expect(puts[1]?.version).toBe(4);
    expect(puts[1]?.document.headline).toBe('Senior Full-Stack EngineerAB');

    await vi.advanceTimersByTimeAsync(5000);
    expect(puts).toHaveLength(2);
    expect(headline).toHaveValue('Senior Full-Stack EngineerAB');
    expect(screen.queryByText(/changed elsewhere/)).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved');
  });

  it('WEB-8 — a conflict loads the latest version and says so', async () => {
    let cvRequests = 0;
    const attempts: UpdateDocumentRequest[] = [];
    const { user } = await mountEditor();
    server.use(
      mockRoute('getCv', () => {
        cvRequests += 1;
        return cvDetail({
          document: editorDocument({ headline: 'Changed on another device' }),
          version: 5,
        });
      }),
      mockRoute('updateDocument', ({ body }) => {
        attempts.push(body as UpdateDocumentRequest);
        return attempts.length === 1
          ? problem('VERSION_CONFLICT')
          : { document: (body as UpdateDocumentRequest).document, version: 6 };
      }),
    );

    await user.type(screen.getByLabelText('Headline'), 'A');
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(
        screen.getByText('This CV was changed elsewhere. We loaded the latest version.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Headline')).toHaveValue('Changed on another device');
    });
    expect(cvRequests).toBe(1);
    // The reload is not an edit: nothing is sent for it.
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toHaveLength(1);

    // The next edit is based on the version that was loaded.
    await user.type(screen.getByLabelText('Headline'), '!');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(attempts).toHaveLength(2);
    });
    expect(attempts[1]?.version).toBe(5);
    expect(attempts[1]?.document.headline).toBe('Changed on another device!');
  });

  it('a conflict whose reload also fails reads "Save failed" and tries again', async () => {
    let saves = 0;
    const { user } = await mountEditor();
    server.use(
      mockRoute('getCv', () => problem('INTERNAL')),
      mockRoute('updateDocument', () => {
        saves += 1;
        return problem('VERSION_CONFLICT');
      }),
    );

    await user.type(screen.getByLabelText('Headline'), 'A');
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Save failed');
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(saves).toBe(2);
    });
  });

  it('WEB-9 — read-only while AI updates a card, editable again when the job ends', async () => {
    const running = job({
      kind: 'apply_answer',
      status: 'running',
      step: 'write',
      target: {
        questionId: '5d1f0a77-3c2e-4b8a-9f61-2e8c7a4b9d10',
        section: 'experience',
        itemId: 'pos-2',
      },
    });
    let finished = false;
    server.use(mockRoute('getJob', () => (finished ? job() : running)));
    const { user, puts } = await mountEditor({ job: running });
    server.use(
      mockRoute('getCv', () =>
        cvDetail({
          document: finished
            ? editorDocument({ headline: 'Rewritten by the AI job' })
            : editorDocument(),
          version: 4,
          job: finished ? job() : running,
        }),
      ),
    );

    expect(screen.getByLabelText('Headline')).toBeDisabled();
    for (const input of [...screen.getAllByRole('textbox'), ...screen.getAllByRole('combobox')]) {
      expect(input).toBeDisabled();
    }
    const updating = screen.getByText('Updating…');
    expect(updating.closest('details')).toBe(card('Brightpath Studio'));

    finished = true;
    await vi.advanceTimersByTimeAsync(1500);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Headline')).toBeEnabled();
      expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
    });
    // The form follows the document the job wrote, and the next save is based on its version.
    expect(screen.getByLabelText('Headline')).toHaveValue('Rewritten by the AI job');
    await user.type(screen.getByLabelText('Headline'), '!');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]?.version).toBe(4);
  });

  it('WEB-12 — the preview page is set once and only its body follows the edits', async () => {
    const { user } = await mountEditor();
    const frame = document.querySelector('iframe');
    if (!frame?.contentDocument) throw new Error('No preview iframe');
    frame.contentDocument.documentElement.dataset.marker = 'set-once';
    const page = frame.contentDocument.documentElement;

    const name = screen.getByLabelText('Full name');
    await user.type(name, 'X');
    await user.type(name, 'Y');
    await user.type(name, 'Z');

    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame.contentDocument.documentElement).toBe(page);
    expect(page.dataset.marker).toBe('set-once');
    expect(previewText()).toContain('Iryna KovalenkoXYZ');
  });

  it('WEB-14 — ↑ moves a position up and autosaves the new order', async () => {
    const { user, puts } = await mountEditor();
    const experience = within(screen.getByRole('region', { name: 'Experience' }));
    const [firstUp, secondUp] = experience.getAllByRole('button', { name: 'Move up' });
    expect(firstUp).toBeDisabled();

    await user.click(secondUp!);
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]?.document.experience.map((position) => position.id)).toEqual(['pos-2', 'pos-1']);
  });

  it('WEB-15 — a link without a scheme gets https://, an invalid one blocks the save', async () => {
    const { user, puts } = await mountEditor();
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    const link = screen.getByLabelText('Link 1');

    await user.type(link, 'linkedin.com/in/iryna');
    await user.tab();
    expect(link).toHaveValue('https://linkedin.com/in/iryna');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]?.document.contacts.links).toEqual(['https://linkedin.com/in/iryna']);

    await user.clear(link);
    await user.type(link, 'https://');
    await user.tab();
    await vi.advanceTimersByTimeAsync(5000);

    expect(screen.getByText('Use an http(s), mailto or tel link')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent(
      'Not saved — fix the highlighted field',
    );
    expect(puts).toHaveLength(1);
  });

  it.each([
    ['a position', 'Brightpath Studio', 'Remove this position?'],
    ['an education entry', 'State University of Technology', 'Remove this education entry?'],
  ])('WEB-16 — removing %s asks first', async (_name, org, title) => {
    const { user, puts } = await mountEditor();

    await user.click(within(card(org)).getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(title);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByText(org, { selector: '.entry-card__org' })).toBeInTheDocument();
    expect(puts).toHaveLength(0);

    await user.click(within(card(org)).getByRole('button', { name: 'Remove' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(screen.queryByText(org, { selector: '.entry-card__org' })).not.toBeInTheDocument();
    const sent = JSON.stringify(puts[0]?.document);
    expect(sent).not.toContain(org);
  });

  it('WEB-16 — removing a section asks first; a single line goes at once', async () => {
    const { user, puts } = await mountEditor();
    const section = () => within(screen.getByRole('region', { name: 'Additional sections' }));

    await user.click(section().getByRole('button', { name: 'Remove section' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Remove this section?');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(0);
    expect(screen.getByDisplayValue('Languages')).toBeInTheDocument();

    await user.click(section().getAllByRole('button', { name: 'Remove line' })[0]!);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    const lines = puts[0]?.document.additional[0]?.entries[0];
    expect(lines && bulletsOf(lines).map((line) => line.text)).toEqual(['English — C1']);

    await user.click(section().getByRole('button', { name: 'Remove section' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(puts).toHaveLength(2);
    });
    expect(puts[1]?.document.additional).toEqual([]);
  });

  it('beforeunload is prevented while changes are unsaved and not afterwards', async () => {
    const { user } = await mountEditor();
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);

    await user.type(screen.getByLabelText('Headline'), '!');
    expect(unload()).toBe(true);

    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => {
      expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved');
    });
    expect(unload()).toBe(false);
  });

  it('retries a failed save with backoff and reports "Save failed" when it gives up', async () => {
    let attempts = 0;
    const { user } = await mountEditor();
    server.use(
      mockRoute('updateDocument', () => {
        attempts += 1;
        return problem('INTERNAL');
      }),
    );

    await user.type(screen.getByLabelText('Headline'), '!');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(attempts).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(attempts).toBe(2);
    });
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {
      expect(attempts).toBe(3);
    });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => {
      expect(attempts).toBe(4);
      expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Save failed');
    });
    await vi.advanceTimersByTimeAsync(20000);
    expect(attempts).toBe(4);
  });

  it('dates are two selects: "—" for no month saves the year alone, Present clears the end', async () => {
    const { user, puts } = await mountEditor();
    const second = within(card('Brightpath Studio'));

    await user.selectOptions(second.getAllByLabelText('Start month')[0]!, '—');
    await user.click(second.getByLabelText('Present'));
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    const saved = puts[0]?.document.experience[1];
    expect(saved).toMatchObject({ start: '2021', end: null, current: true });
    expect(second.getAllByLabelText('End year')[0]).toBeDisabled();
  });

  it('a PUT answered JOB_ACTIVE says so and the form turns read-only', async () => {
    const { user } = await mountEditor();
    const running = job({ kind: 'apply_answer', status: 'running', step: 'write' });
    server.use(
      mockRoute('updateDocument', () => problem('JOB_ACTIVE')),
      mockRoute('getCv', () => cvDetail({ document: editorDocument(), job: running })),
      mockRoute('getJob', () => running),
    );

    await user.type(screen.getByLabelText('Headline'), 'A');
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Headline')).toBeDisabled();
    });
    expect(
      screen.getByText('The CV is being updated, so your last changes were not saved.'),
    ).toBeInTheDocument();
  });

  it('leaving the page sends what is still waiting for the debounce', async () => {
    const { user, puts } = await mountEditor();
    server.use(mockRoute('listCvs', () => ({ items: [] })));

    await user.type(screen.getByLabelText('Headline'), '!');
    expect(puts).toHaveLength(0);
    await user.click(screen.getByRole('link', { name: 'CV Builder' }));

    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]?.document.headline).toBe('Senior Full-Stack Engineer!');
  });

  it('typing a change and undoing it saves nothing', async () => {
    const { user, puts } = await mountEditor();
    const headline = screen.getByLabelText('Headline');

    await user.type(headline, 'A');
    await user.type(headline, '{Backspace}');
    await vi.advanceTimersByTimeAsync(5000);

    expect(puts).toHaveLength(0);
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved');
  });

  it('a refused save (400) is not retried and its message stays', async () => {
    let attempts = 0;
    const { user } = await mountEditor();
    server.use(
      mockRoute('updateDocument', () => {
        attempts += 1;
        return problem('VALIDATION_FAILED');
      }),
    );

    await user.type(screen.getByLabelText('Headline'), 'A');
    await vi.advanceTimersByTimeAsync(20000);

    expect(attempts).toBe(1);
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Save failed');
    expect(screen.getByText('Some of the entered data is not valid.')).toBeInTheDocument();
  });

  it('a fresh link row has no error, and fixing an invalid link saves again', async () => {
    const { user, puts } = await mountEditor();
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    const link = screen.getByLabelText('Link 1');
    expect(screen.queryByText('Use an http(s), mailto or tel link')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(0);

    await user.type(link, 'https://');
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent(
      'Not saved — fix the highlighted field',
    );
    await user.type(link, 'example.com/me');
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]?.document.contacts.links).toEqual(['https://example.com/me']);
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved');
  });

  it('a moved position keeps its own bullets, in the form and in the save', async () => {
    const { user, puts } = await mountEditor();
    const experience = within(screen.getByRole('region', { name: 'Experience' }));

    await user.click(experience.getAllByRole('button', { name: 'Move up' })[1]!);
    await user.type(within(card('Brightpath Studio')).getByLabelText('Bullet 1'), ' Extended.');
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    const [first, second] = puts[0]?.document.experience ?? [];
    expect(first?.id).toBe('pos-2');
    expect(first && bulletsOf(first).map((bullet) => bullet.text)).toEqual([
      'Developed REST APIs in NestJS. Extended.',
    ]);
    expect(second && bulletsOf(second)).toHaveLength(2);
    expect(within(card('Northwind Learning')).getByLabelText('Bullet 2')).toHaveValue(
      'Designed a PostgreSQL-backed job queue.',
    );
  });
});
