import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Typst branding', () => {
  render(<App />);
  const headings = screen.getAllByText(/Typst/i);
  expect(headings.length).toBeGreaterThan(0);
});
