import { createEffect, For, onCleanup, Show } from 'solid-js';
import { Badge, Button, EmptyState, IconButton, InlineNotice, LoadingState } from '@peri/ui';
import { readOnly } from '@/features/auth/auth-state';
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
} from '@/features/mcp/mcp';
import { RefreshCw } from 'lucide-solid';
import { ResourceSectionTitle } from '@peri/ui';

export function McpPanelContent(props: { embedded?: boolean } = {}) {
  createEffect(() => {
    refreshMcpServers();
  });
  onCleanup(clearMcpAuthorization);
  const flowFor = (flowId?: string) => flowId ? mcpOAuthEvents()[flowId] : undefined;
  const connectionLabel = (status: string) => ({ connected: 'Connected', failed: 'Connection failed', disconnected: 'Disconnected', disabled: 'Disabled', uninitialized: 'Uninitialized' }[status] || status);

  return <section class={props.embedded ? 'ui-scrollbar min-h-0 flex-1 overflow-auto bg-surface' : 'w-(--container-mcp) max-h-(--container-settings-tall) overflow-auto p-22 max-compact:w-(--container-mcp-compact) max-compact:p-17'} aria-labelledby="mcp-panel-title">
      <Show when={props.embedded} fallback={(
        <div class="flex items-start justify-between gap-20 max-compact:gap-10">
          <div><h2 id="mcp-panel-title" class="m-0 text-19 text-text-primary -tracking-dialog">MCP connections</h2><p class="mt-5 mb-0 text-text-secondary text-13 leading-15">View the MCP services of the current Peri runtime and complete authorization as needed.</p></div>
          <Button size="compact" busy={mcpLoading()} class="min-w-58 shrink-0 whitespace-nowrap max-compact:min-h-44" onClick={refreshMcpServers}>Refresh</Button>
        </div>
      )}>
        <ResourceSectionTitle compact>
          <div class="flex min-w-0 flex-1 items-center justify-between gap-6">
            <h2 id="mcp-panel-title" class="m-0 text-10 font-650 uppercase tracking-6 text-text-secondary">Connections</h2>
            <IconButton label="Refresh MCP connections" size="compact" busy={mcpLoading()} onClick={refreshMcpServers} class="border-0 bg-transparent text-text-muted"><RefreshCw size={14} strokeWidth={1.7} /></IconButton>
          </div>
        </ResourceSectionTitle>
      </Show>
      <Show when={mcpServers().length} fallback={<Show when={mcpLoading()} fallback={<Show when={props.embedded} fallback={<EmptyState title="No MCP servers" description="The current runtime has no MCP servers to manage." />}><p class="m-0 px-10 py-12 text-11 leading-16 text-text-muted">No MCP servers</p></Show>}><LoadingState class={props.embedded ? 'm-8 p-8! text-left!' : 'mt-20'} label="Reading MCP servers" description="Reading Peri’s secure connection snapshot…" /></Show>}>
        <div class={props.embedded ? 'grid' : 'mt-20 grid gap-10'}>
          <For each={mcpServers()}>{(server) => {
            const flow = () => flowFor(server.activeFlowId);
            const exactAuthorization = () => {
              const grant = mcpAuthorization();
              return grant && grant.flowId === server.activeFlowId ? grant : null;
            };
            return <article class={props.embedded ? 'border-b border-divider bg-surface px-8 py-7' : 'rounded-12 border border-divider bg-surface p-15'}>
              <div class={`flex items-start justify-between ${props.embedded ? 'gap-6' : 'gap-12'}`}>
                <div class={`grid min-w-0 ${props.embedded ? 'gap-1' : 'gap-2'}`}><strong class={`overflow-hidden text-ellipsis whitespace-nowrap text-text-primary ${props.embedded ? 'text-11 font-600' : 'text-14'}`}>{server.name}</strong><span class={`font-mono text-text-secondary ${props.embedded ? 'text-9' : 'text-12'}`}>{server.transport}</span></div>
                <Badge tone={server.connectionStatus === 'connected' ? 'ok' : server.connectionStatus === 'failed' ? 'err' : 'neutral'}>{connectionLabel(server.connectionStatus)}</Badge>
              </div>
              <div class={`${props.embedded ? 'mt-4 gap-x-8 gap-y-2 text-10' : 'mt-10 gap-x-14 gap-y-5 text-12'} flex flex-wrap text-text-secondary`}>
                <span>{server.toolsCount} tools</span><span>{server.resourcesCount} resources</span>
                <Show when={server.oauthStatus === 'authorized'}><span>Authorized</span></Show>
                <Show when={flow()?.status === 'failed'}><span class="text-danger">Authorization failed; you can retry</span></Show>
              </div>
              <div class={`${props.embedded ? 'mt-6 gap-4' : 'mt-13 gap-7'} flex flex-wrap`}>
                <Show when={server.oauthStatus === 'needs_authorization' && !server.activeFlowId}>
                  <Button variant="primary" size={props.embedded ? 'compact' : undefined} class={props.embedded ? 'min-h-28! text-10!' : 'max-compact:min-h-44 max-compact:flex-1'} disabled={readOnly()} onClick={() => startMcpOAuth(server.name)}>{props.embedded ? 'Authorize' : 'Start authorization'}</Button>
                </Show>
                <Show when={server.activeFlowId && flow()?.status === 'authorization_needed'}>
                  <Button variant="primary" size={props.embedded ? 'compact' : undefined} class={props.embedded ? 'min-h-28! text-10!' : 'max-compact:min-h-44 max-compact:flex-1'} disabled={readOnly()} onClick={() => requestMcpAuthorization(server.activeFlowId!)}>{props.embedded ? 'Open link' : 'Get authorization link'}</Button>
                  <Button size={props.embedded ? 'compact' : undefined} class={props.embedded ? 'min-h-28! text-10!' : 'max-compact:min-h-44 max-compact:flex-1'} disabled={readOnly()} onClick={() => cancelMcpOAuth(server.activeFlowId!)}>{props.embedded ? 'Cancel' : 'Cancel authorization'}</Button>
                </Show>
                <Show when={exactAuthorization()}>{(grant) => <a class={`mcp-auth-link inline-flex items-center justify-center rounded-8 border border-transparent bg-btn-primary font-500 text-surface no-underline cursor-pointer hover:bg-btn-primary-hover active:translate-y-1 pointer-coarse:min-h-44 ${props.embedded ? 'min-h-28 px-8 text-10' : 'min-h-36 gap-8 px-12 text-14 max-compact:min-h-44 max-compact:flex-1'}`} href={grant().authorizationUrl} target="_blank" rel="noopener noreferrer">Open authorization page</a>}</Show>
              </div>
              <Show when={exactAuthorization()}><InlineNotice class="mt-10" tone="info">The authorization URL is kept in memory for this page only and expires soon. After opening it, come back here to check the connection result.</InlineNotice></Show>
            </article>;
          }}</For>
        </div>
      </Show>
      <Show when={readOnly()}><InlineNotice class={props.embedded ? 'm-8 text-10' : 'mt-16'} tone="info">Read-only sign-in can view MCP status but cannot start, read or cancel authorizations.</InlineNotice></Show>
    </section>;
}
