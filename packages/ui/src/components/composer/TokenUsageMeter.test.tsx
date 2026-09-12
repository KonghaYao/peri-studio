import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenUsageMeter, tokenUsageLabel } from './TokenUsageMeter';

afterEach(() => cleanup());

describe('TokenUsageMeter', () => {
  it('accepts numeric breakdown props', () => {
    render(() => <TokenUsageMeter input={100} output={50} cached={25} limit={1000} data-testid="meter" />);
    expect(screen.getByTestId('meter')).toHaveClass('ui-token-usage-trigger');
    expect(screen.getByTestId('meter').querySelector('.token-usage-meter__ring')).toBeTruthy();
  });

  it('accepts usage snapshot props', () => {
    render(() => (
      <TokenUsageMeter usage={{ inputTokens: 100, outputTokens: 50, cacheReadTokens: 25 }} data-testid="meter" />
    ));
    expect(screen.getByTestId('meter')).toBeInTheDocument();
  });

  it('formats usage label', () => {
    expect(tokenUsageLabel({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0 }))
      .toBe('Input 1,200 · Output 300 · Cached 0');
  });
});
