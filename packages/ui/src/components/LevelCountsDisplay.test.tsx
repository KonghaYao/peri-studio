import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { LevelCountsDisplay } from './LevelCountsDisplay';

afterEach(() => cleanup());

describe('LevelCountsDisplay', () => {
  it('renders only non-zero counts with symbols', () => {
    render(() => (
      <LevelCountsDisplay
        data-testid="levels"
        counts={[
          { level: 'ERROR', count: 2, symbol: '🚨' },
          { level: 'WARNING', count: 0, symbol: '⚠️' },
          { level: 'DEBUG', count: 1, symbol: '🔍' },
        ]}
      />
    ));

    expect(screen.getByTestId('levels')).toHaveTextContent('🚨 2');
    expect(screen.getByTestId('levels')).toHaveTextContent('🔍 1');
    expect(screen.getByTestId('levels')).not.toHaveTextContent('⚠️');
  });

  it('shows skeleton while loading', () => {
    const { container } = render(() => <LevelCountsDisplay counts={[]} isLoading />);
    expect(container.querySelector('.ui-skeleton')).toBeInTheDocument();
  });

  it('uses custom number formatter when provided', () => {
    render(() => (
      <LevelCountsDisplay
        counts={[
          {
            level: 'ERROR',
            count: 99,
            symbol: '🚨',
            customNumberFormatter: () => 'ninety-nine',
          },
        ]}
      />
    ));
    expect(screen.getByText(/ninety-nine/)).toBeInTheDocument();
  });
});
