import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenUsageBadge } from './TokenUsageBadge';

afterEach(() => cleanup());

describe('TokenUsageBadge', () => {
  it('renders usage summary with en-US grouping', () => {
    render(() => (
      <TokenUsageBadge inputUsage={24538} outputUsage={70} totalUsage={24608} data-testid="badge" />
    ));
    expect(screen.getByText('24,538 → 70 (∑ 24,608)')).toBeInTheDocument();
  });

  it('hides zero usage', () => {
    render(() => <TokenUsageBadge inputUsage={0} outputUsage={0} totalUsage={0} data-testid="badge" />);
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
  });

  it('renders inline mode without badge shell', () => {
    const { container } = render(() => (
      <TokenUsageBadge inputUsage={12} outputUsage={34} totalUsage={46} inline data-testid="badge" />
    ));
    expect(screen.getByText('12 → 34 (∑ 46)')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('renders optional right icon', () => {
    render(() => (
      <TokenUsageBadge
        inputUsage={12}
        outputUsage={34}
        totalUsage={46}
        rightIcon={<span data-testid="icon">*</span>}
      />
    ));
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
