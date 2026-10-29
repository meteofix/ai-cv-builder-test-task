import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrashBoundary } from './CrashBoundary';

function Broken(): never {
  throw new Error('Bio of Olena Hrytsenko');
}

beforeEach(() => {
  // React logs a caught render error; the test expects it.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('shows a plain message with a Reload button and none of the error text when a child throws', () => {
  render(
    <CrashBoundary>
      <Broken />
    </CrashBoundary>,
  );
  expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i);
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  expect(document.body.textContent).not.toContain('Olena');
});

it('renders its children when nothing throws', () => {
  render(
    <CrashBoundary>
      <p>fine</p>
    </CrashBoundary>,
  );
  expect(screen.getByText('fine')).toBeTruthy();
});
