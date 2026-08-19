import { createEffect, For, Show } from 'solid-js';
import { Badge, Button, Dialog, DialogContent, DialogTitle, EmptyState, InlineNotice, LoadingState } from '../../components/ui';
import { readOnly } from '../lib/auth-state';
import {
  cancelMcpOAuth,
  clearMcpAuthorization,
  mcpAuthorization,
  mcpLoading,
  mcpOAuthEvents,
  mcpServers,
  refreshMcpServers,
  requestMcpAuthorization,
  startMcpOAuth,
} from '../lib/mcp';

export function McpPanel(props: { open: boolean; onClose: () => void }) {
  createEffect(() => {
    if (props.open) refreshMcpServers();
    else clearMcpAuthorization();
  });
  const flowFor = (flowId?: string) => flowId ? mcpOAuthEvents()[flowId] : undefined;
  const connectionLabel = (status: string) => ({ connected: 'Connected', failed: 'Connection failed', disconnected: 'Disconnected', disabled: 'Disabled', uninitialized: 'Uninitialized' }[status] || status);

  return <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}><DialogContent size="mcp"><DialogTitle class="sr-only">MCP connections</DialogTitle>
    <section class="mcp-panel p-22" aria-labelledby="mcp-panel-title">
      <div class="mcp-panel__header flex items-start justify-between gap-20">
        <div><h2 id="mcp-panel-title">MCP connections</h2><p>View the MCP services of the current Peri runtime and complete authorization as needed.</p></div>
        <Button size="compact" busy={mcpLoading()} onClick={refreshMcpServers}>Refresh</Button>
      </div>
      <Show when={mcpServers().length} fallback={<Show when={mcpLoading()} fallback={<EmptyState title="No MCP servers" description="The current runtime has no MCP servers to manage." />}><LoadingState class="mcp-panel__loading mt-20" label="Reading MCP servers" description="Reading Peri’s secure connection snapshot…" /></Show>}>
        <div class="mcp-server-list grid gap-10 mt-20">
          <For each={mcpServers()}>{(server) => {
            const flow = () => flowFor(server.activeFlowId);
            const exactAuthorization = () => {
              const grant = mcpAuthorization();
              return grant && grant.flowId === server.activeFlowId ? grant : null;
            };
            return <article class="mcp-server-card p-15 border border-divider rounded-14 bg-surface-muted">
              <div class="mcp-server-card__identity flex items-start justify-between gap-12">
                <div><strong>{server.name}</strong><span>{server.transport}</span></div>
                <Badge tone={server.connectionStatus === 'connected' ? 'ok' : server.connectionStatus === 'failed' ? 'err' : 'neutral'}>{connectionLabel(server.connectionStatus)}</Badge>
              </div>
              <div class="mcp-server-card__facts flex flex-wrap gap-x-14 gap-y-5 mt-10 text-text-secondary text-12">
                <span>{server.toolsCount} tools</span><span>{server.resourcesCount} resources</span>
                <Show when={server.oauthStatus === 'authorized'}><span>Authorized</span></Show>
                <Show when={flow()?.status === 'failed'}><span class="mcp-server-card__error text-danger">Authorization failed; you can retry</span></Show>
              </div>
              <div class="mcp-server-card__actions flex flex-wrap gap-7 mt-13">
                <Show when={server.oauthStatus === 'needs_authorization' && !server.activeFlowId}>
                  <Button variant="primary" disabled={readOnly()} onClick={() => startMcpOAuth(server.name)}>Start authorization</Button>
                </Show>
                <Show when={server.activeFlowId && flow()?.status === 'authorization_needed'}>
                  <Button variant="primary" disabled={readOnly()} onClick={() => requestMcpAuthorization(server.activeFlowId!)}>Get authorization link</Button>
                  <Button disabled={readOnly()} onClick={() => cancelMcpOAuth(server.activeFlowId!)}>Cancel authorization</Button>
                </Show>
                <Show when={exactAuthorization()}>{(grant) => <a class="ui-button ui-button--primary ui-button--default" href={grant().authorizationUrl} target="_blank" rel="noopener noreferrer">Open authorization page</a>}</Show>
              </div>
              <Show when={exactAuthorization()}><InlineNotice class="mcp-server-card__notice mt-10" tone="info">The authorization URL is kept in memory for this page only and expires soon. After opening it, come back here to check the connection result.</InlineNotice></Show>
            </article>;
          }}</For>
        </div>
      </Show>
      <Show when={readOnly()}><InlineNotice class="mcp-panel__readonly mt-16" tone="info">Read-only sign-in can view MCP status but cannot start, read or cancel authorizations.</InlineNotice></Show>
    </section>
  </DialogContent></Dialog>;
}
