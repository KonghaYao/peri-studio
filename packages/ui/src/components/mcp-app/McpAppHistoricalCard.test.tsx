import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { McpAppHistoricalCard } from './McpAppHistoricalCard';

describe('McpAppHistoricalCard', () => {
  it('renders title, subtitle and unavailable message', () => {
    const view = render(() => (
      <McpAppHistoricalCard
        title="MCP App · show canvas"
        subtitle="cursor canvas"
        message="This app isn't available in restored history."
      />
    ));

    expect(screen.getByTestId('mcp-app-historical-card')).toBeInTheDocument();
    expect(screen.getByText('MCP App · show canvas')).toBeInTheDocument();
    expect(screen.getByText('cursor canvas')).toBeInTheDocument();
    expect(screen.getByText("This app isn't available in restored history.")).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.unmount();
  });

  it('renders Reopen app button and calls onReopen when clicked', () => {
    const onReopen = vi.fn();
    const view = render(() => (
      <McpAppHistoricalCard
        title="MCP App · show canvas"
        message="Unavailable"
        reopenLabel="Reopen app"
        onReopen={onReopen}
      />
    ));

    fireEvent.click(screen.getByTestId('mcp-app-reopen-button'));
    expect(onReopen).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('disables Reopen app while pending', () => {
    const view = render(() => (
      <McpAppHistoricalCard
        title="MCP App"
        message="Unavailable"
        reopenLabel="Reopen app"
        reopenPending
        onReopen={() => undefined}
      />
    ));

    expect(screen.getByTestId('mcp-app-reopen-button')).toBeDisabled();
    view.unmount();
  });

  it('applies activity variant class', () => {
    const view = render(() => (
      <McpAppHistoricalCard
        title="MCP App"
        message="Unavailable"
        variant="activity"
      />
    ));

    expect(screen.getByTestId('mcp-app-historical-card')).toHaveClass('tool-activity-row--activity');
    view.unmount();
  });
});
