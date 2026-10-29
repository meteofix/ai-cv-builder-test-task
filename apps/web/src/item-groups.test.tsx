import { bulletsOf, LIMITS, type CvDocument, type UpdateDocumentRequest } from '@cv/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { editorDocument } from './test/fixtures';
import { CV_ID, cvDetail, job, mockRoute, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

async function mountEditor(doc: CvDocument = editorDocument()) {
  const puts: UpdateDocumentRequest[] = [];
  server.use(
    mockRoute('me', () => USER),
    mockRoute('getCv', () => cvDetail({ document: doc, version: 3, job: job() })),
    mockRoute('getNotInCv', () => ({ items: [] })),
    mockRoute('updateDocument', ({ body }) => {
      const request = body as UpdateDocumentRequest;
      puts.push(request);
      return { document: request.document, version: request.version + 1 };
    }),
  );
  const view = renderApp(`/cvs/${CV_ID}`);
  await screen.findByLabelText('Headline');
  return { ...view, puts };
}

/** Waits until the last saved document passes `check`: autosave may send several PUTs on the way. */
async function savedWhere(puts: UpdateDocumentRequest[], check: (document: CvDocument) => void) {
  await vi.waitFor(
    () => {
      const last = puts.at(-1)?.document;
      if (!last) throw new Error('Nothing saved yet');
      check(last);
    },
    { timeout: 4000 },
  );
}

function card(org: string) {
  const found = screen.getByText(org, { selector: '.entry-card__org' }).closest('details');
  if (!found) throw new Error(`No card for ${org}`);
  return within(found);
}

const extra = () => within(screen.getByRole('region', { name: 'Additional sections' }));

describe('subsections of a position', () => {
  it('a plain list gets a title through "Add a subsection title"; clearing it makes it plain again', async () => {
    const { user, puts } = await mountEditor();
    const position = card('Brightpath Studio');
    expect(position.queryByLabelText('Subsection 1 title')).toBeNull();

    await user.click(position.getByRole('button', { name: 'Add a subsection title' }));
    const title = position.getByLabelText('Subsection 1 title');
    expect(title).toHaveFocus();
    await user.type(title, 'Platform');
    await savedWhere(puts, (document) => {
      expect(document.experience[1]?.groups[0]?.title).toBe('Platform');
    });

    await user.clear(title);
    // The field stays while the person edits it.
    expect(position.getByLabelText('Subsection 1 title')).toBeInTheDocument();
    await savedWhere(puts, (document) => {
      expect(document.experience[1]?.groups[0]?.title).toBeNull();
    });
  });

  it('"Add subsection" starts a titled group with its own bullets; its items keep their own ids', async () => {
    const { user, puts } = await mountEditor();
    const position = card('Brightpath Studio');

    await user.click(position.getByRole('button', { name: 'Add subsection' }));
    const second = within(position.getByRole('group', { name: 'Subsection 2' }));
    await user.type(second.getByLabelText('Subsection 2 title'), 'Team');
    await user.type(second.getByLabelText('Bullet 1'), 'Hired two engineers.');
    await user.click(second.getByRole('button', { name: 'Add bullet' }));
    await user.type(second.getByLabelText('Bullet 2'), 'Ran the onboarding.');

    await savedWhere(puts, (document) => {
      const groups = document.experience[1]?.groups ?? [];
      expect(groups).toMatchObject([
        { id: 'pos-2-g1', title: null, items: [{ id: 'b-3' }] },
        {
          title: 'Team',
          items: [{ text: 'Hired two engineers.' }, { text: 'Ran the onboarding.' }],
        },
      ]);
      const ids = bulletsOf({ groups }).map((bullet) => bullet.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('removing a subsection with bullets asks first; an empty one goes at once', async () => {
    const { user, puts } = await mountEditor();
    const position = card('Northwind Learning');
    await user.click(position.getByRole('button', { name: 'Add subsection' }));
    await user.click(position.getByRole('button', { name: 'Remove subsection 2' }));
    expect(position.queryByRole('group', { name: 'Subsection 2' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    // With two groups, the first (with bullets) can be removed too, after a confirmation.
    await user.click(position.getByRole('button', { name: 'Add subsection' }));
    await user.click(position.getByRole('button', { name: 'Remove subsection 1' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Remove this subsection?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Remove' }));

    await user.type(position.getByLabelText('Bullet 1'), 'Only this one.');
    await savedWhere(puts, (document) => {
      expect(document.experience[0]?.groups).toMatchObject([
        { title: null, items: [{ text: 'Only this one.' }] },
      ]);
    });
  });

  it('↓ moves a bullet down inside its group and keeps its id', async () => {
    const { user, puts } = await mountEditor();
    const position = card('Northwind Learning');
    expect(position.getByRole('button', { name: 'Move bullet 1 up' })).toBeDisabled();

    await user.click(position.getByRole('button', { name: 'Move bullet 1 down' }));

    expect(position.getByLabelText('Bullet 1')).toHaveValue(
      'Designed a PostgreSQL-backed job queue.',
    );
    await savedWhere(puts, (document) => {
      expect(document.experience[0]?.groups[0]?.items.map((bullet) => bullet.id)).toEqual([
        'b-2',
        'b-1',
      ]);
    });
  });

  it('a position without groups gets one with its first bullet', async () => {
    const doc = editorDocument();
    const { user, puts } = await mountEditor({
      ...doc,
      experience: doc.experience.map((position, i) =>
        i === 1 ? { ...position, groups: [] } : position,
      ),
    });
    const position = card('Brightpath Studio');
    await user.click(position.getAllByRole('button', { name: 'Add bullet' })[0]!);
    await user.type(position.getByLabelText('Bullet 1'), 'Shipped the first release.');

    await savedWhere(puts, (document) => {
      expect(document.experience[1]?.groups).toMatchObject([
        { title: null, items: [{ text: 'Shipped the first release.' }] },
      ]);
    });
  });
});

describe('entries of an additional section', () => {
  it('"Add entry" takes a title, dates and lines in groups', async () => {
    const { user, puts } = await mountEditor();

    await user.click(extra().getByRole('button', { name: 'Add entry' }));
    const entry = within(extra().getByRole('group', { name: 'Entry 2' }));
    await user.type(entry.getByLabelText('Entry 2 title'), 'Trail map app');
    await user.selectOptions(entry.getByLabelText('Start year'), '2022');
    await user.click(entry.getByRole('button', { name: 'Add line' }));
    await user.type(entry.getByLabelText('Line 1'), 'Offline maps for hikers.');
    await user.click(entry.getByRole('button', { name: 'Add subsection' }));
    const stack = within(entry.getByRole('group', { name: 'Subsection 2' }));
    await user.type(stack.getByLabelText('Subsection 2 title'), 'Stack');
    await user.type(stack.getByLabelText('Line 1'), 'Kotlin, SQLite');

    await savedWhere(puts, (document) => {
      expect(document.additional[0]?.entries[1]).toMatchObject({
        title: 'Trail map app',
        start: '2022',
        end: null,
        groups: [
          { title: null, items: [{ text: 'Offline maps for hikers.' }] },
          { title: 'Stack', items: [{ text: 'Kotlin, SQLite' }] },
        ],
      });
    });
  });

  it('stops adding lines at the cap across the groups of an entry', async () => {
    const lines = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `l${from + i}`,
        text: `Line ${from + i}`,
        factIds: [],
      }));
    const groups = [
      { id: 'g1', title: null, items: lines(1, LIMITS.maxLinesPerEntry - 5) },
      { id: 'g2', title: 'More', items: lines(LIMITS.maxLinesPerEntry - 4, 5) },
    ];
    const entry = { id: 'add-1-e1', title: 'Course', start: null, end: null, groups };
    await mountEditor(
      editorDocument({ additional: [{ id: 'add-1', title: 'Courses', entries: [entry] }] }),
    );
    for (const button of extra().getAllByRole('button', { name: /^Add (line|subsection)$/ })) {
      expect(button).toBeDisabled();
    }
  });

  it('removing an entry asks first', async () => {
    const { user, puts } = await mountEditor();
    await user.click(extra().getByRole('button', { name: 'Remove entry' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Remove this entry?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(extra().getByLabelText('Line 1')).toHaveValue('Ukrainian — native');

    await user.click(extra().getByRole('button', { name: 'Remove entry' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(extra().queryByLabelText('Line 1')).toBeNull();
    await savedWhere(puts, (document) => {
      expect(document.additional[0]?.entries).toEqual([]);
    });
  });
});
