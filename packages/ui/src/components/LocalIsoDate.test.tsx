import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLocalIsoDate } from '../lib/format-local-iso-date';
import { LocalIsoDate } from './LocalIsoDate';

afterEach(() => cleanup());

describe('LocalIsoDate', () => {
  const sample = new Date(Date.UTC(2024, 5, 15, 14, 30, 45, 123));

  it('renders local ISO string with UTC tooltip', () => {
    render(() => <LocalIsoDate date={sample} data-testid="date" />);
    const node = screen.getByTestId('date');
    expect(node).toHaveTextContent(formatLocalIsoDate(sample, false, 'second'));
    expect(node).toHaveAttribute('title', `UTC: ${formatLocalIsoDate(sample, true, 'millisecond')}`);
    expect(node).toHaveAttribute('dateTime', sample.toISOString());
  });

  it('respects accuracy prop', () => {
    render(() => <LocalIsoDate date={sample} accuracy="day" data-testid="date" />);
    expect(screen.getByTestId('date')).toHaveTextContent(formatLocalIsoDate(sample, false, 'day'));
  });

  it('returns null for invalid dates', () => {
    const { container } = render(() => <LocalIsoDate date={new Date('invalid')} />);
    expect(container.firstChild).toBeNull();
  });
});
