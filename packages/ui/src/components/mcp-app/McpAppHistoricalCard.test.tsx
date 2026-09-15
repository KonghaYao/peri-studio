import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { McpAppHistoricalCard } from './McpAppHistoricalCard';

describe('McpAppHistoricalCard', () => {
  it('renders title, subtitle and unavailable message', () => {
    const view = render(() => (
      <McpAppHistoricalCard
        title="MCP App · show canvas"
        subtitle="cursor canvas"
        message="This interactive app is not available in restored history."
      />
    ));

    expect(screen.getByTestId('mcp-app-historical-card')).toBeInTheDocument();
    expect(screen.getByText('MCP App · show canvas')).toBeInTheDocument();
    expect(screen.getByText('cursor canvas')).toBeInTheDocument();
    expect(screen.getByText('This interactive app is not available in restored history.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
