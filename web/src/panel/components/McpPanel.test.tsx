import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { setPrincipalRole } from '../lib/auth-state';
import {
  setMcpAuthorization,
  setMcpLoading,
  setMcpOAuthEvents,
  setMcpServers,
} from '../lib/mcp';
import { setSelectedCid } from '../store';
import { McpPanelContent } from './McpPanel';

afterEach(() => {
  setMcpServers([]);
  setMcpOAuthEvents({});
  setMcpAuthorization(null);
  setMcpLoading(false);
  setSelectedCid(null);
  setPrincipalRole(null);
});

describe('McpPanelContent', () => {
  it('uses compact workbench rows when embedded with the other resource views', () => {
    setPrincipalRole('full');
    setSelectedCid('chat-1');
    setMcpServers([{ name: 'github', transport: 'stdio', connectionStatus: 'connected', oauthStatus: 'authorized', toolsCount: 2, resourcesCount: 1 }]);
    render(() => <McpPanelContent embedded />);

    expect(screen.getByRole('region', { name: 'Connections' })).toHaveClass('bg-surface');
    expect(screen.getByText('github').closest('article')).toHaveClass('border-b', 'bg-surface');
    expect(screen.getByRole('button', { name: 'Refresh MCP connections' })).toBeInTheDocument();
  });

  it('requires a dedicated authorization response before rendering an external link', () => {
    setPrincipalRole('full');
    setSelectedCid('chat-1');
    setMcpServers([{ name: 'github', transport: 'stdio', connectionStatus: 'disconnected', oauthStatus: 'needs_authorization', activeFlowId: 'flow-1', toolsCount: 2, resourcesCount: 1 }]);
    setMcpOAuthEvents({ 'flow-1': { chatId: 'chat-1', flowId: 'flow-1', serverName: 'github', status: 'authorization_needed', updatedAt: '2026-08-15T00:00:00Z' } });
    render(() => <McpPanelContent />);

    expect(screen.getByRole('button', { name: 'Get authorization link' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open authorization page' })).not.toBeInTheDocument();

    setMcpAuthorization({ commandId: 'command-1', chatId: 'chat-1', flowId: 'flow-1', authorizationUrl: 'https://example.test/oauth?state=opaque', expiresAt: '2026-08-15T00:02:00Z' });
    const link = screen.getByRole('link', { name: 'Open authorization page' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('announces server snapshot loading without exposing an empty result as final', () => {
    setPrincipalRole('full');
    setSelectedCid('chat-1');
    setMcpLoading(true);
    render(() => <McpPanelContent />);

    expect(screen.getByRole('status', { name: 'Reading MCP servers' })).toHaveTextContent('Reading Peri’s secure connection snapshot…');
    expect(screen.queryByRole('heading', { name: 'No MCP servers' })).not.toBeInTheDocument();
  });

  it('keeps OAuth mutation controls disabled for read-only principals', () => {
    setPrincipalRole('read-only');
    setSelectedCid('chat-1');
    setMcpServers([{ name: 'github', transport: 'stdio', connectionStatus: 'disconnected', oauthStatus: 'needs_authorization', toolsCount: 0, resourcesCount: 0 }]);
    render(() => <McpPanelContent />);
    expect(screen.getByRole('button', { name: 'Start authorization' })).toBeDisabled();
    expect(screen.getByText(/Read-only sign-in can view/)).toBeInTheDocument();
  });
});
