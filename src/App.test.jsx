import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Typst Webapp heading', () => {
  render(<App />);
  const heading = screen.getByText(/Typst Webapp/i);
  expect(heading).toBeDefined();
});
