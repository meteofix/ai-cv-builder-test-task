import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders and uses the shared package', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'AI CV Builder' })).toBeInTheDocument();
    expect(screen.getByText(/CV languages: en, uk/)).toBeInTheDocument();
  });
});
