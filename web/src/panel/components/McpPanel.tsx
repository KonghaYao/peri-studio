import { createEffect, For, onCleanup, Show } from 'solid-js';
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
  return <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}><DialogContent size="mcp"><DialogTitle class="sr-only">MCP connections</DialogTitle>
    <McpPanelContent />
  </DialogContent></Dialog>;
}

export function McpPanelContent(props: { embedded?: boolean } = {}) {
  createEffect(() => {
    refreshMcpServers();
  });
  onCleanup(clearMcpAuthorization);
  const flowFor = (flowId?: string) => flowId ? mcpOAuthEvents()[flowId] : undefined;
  const connectionLabel = (status: string) => ({ connected: 'Connected', failed: 'Connection failed', disconnected: 'Disconnected', disabled: 'Disabled', uninitialized: 'Uninitialized' }[status] || status);

  return <section class={props.embedded ? 'ui-scrollbar min-h-0 flex-1 overflow-auto p-10' : 'w-[min(620px,calc(100vw-40px))] max-h-[min(76dvh,680px)] overflow-auto p-22 max-[640px]:w-[calc(100vw-24px)] max-[640px]:p-17'} aria-labelledby="mcp-panel-title">
      <div class="flex items-start justify-between gap-20 max-[640px]:gap-10">
        <div><h2 id="mcp-panel-title" class={`m-0 text-text-primary tracking-[-.02em] ${props.embedded ? 'text-13' : 'text-[19px]'}`}>MCP connections</h2><Show when={!props.embedded}><p class="mt-5 mb-0 text-text-secondary text-13 leading-[1.5]">View the MCP services of the current Peri runtime and complete authorization as needed.</p></Show></div>
        <Button size="compact" busy={mcpLoading()} class="min-w-58 shrink-0 whitespace-nowrap max-[640px]:min-h-44" onClick={refreshMcpServers}>Refresh</Button>
      </div>
      <Show when={mcpServers().length} fallback={<Show when={mcpLoading()} fallback={<EmptyState title="No MCP servers" description="The current runtime has no MCP servers to manage." />}><LoadingState class="mt-20" label="Reading MCP servers" description="Reading Peri’s secure connection snapshot…" /></Show>}>
        <div class={`${props.embedded ? 'mt-10 gap-7' : 'mt-20 gap-10'} grid`}>
          <For each={mcpServers()}>{(server) => {
            const flow = () => flowFor(server.activeFlowId);
            const exactAuthorization = () => {
              const grant = mcpAuthorization();
              return grant && grant.flowId === server.activeFlowId ? grant : null;
            };
            return <article class={`rounded-12 border border-divider bg-surface ${props.embedded ? 'p-10' : 'p-15'}`}>
              <div class="flex items-start justify-between gap-12">
                <div class="grid min-w-0 gap-2"><strong class="overflow-hidden text-text-primary text-14 text-ellipsis whitespace-nowrap">{server.name}</strong><span class="text-text-secondary text-12">{server.transport}</span></div>
                <Badge tone={server.connectionStatus === 'connected' ? 'ok' : server.connectionStatus === 'failed' ? 'err' : 'neutral'}>{connectionLabel(server.connectionStatus)}</Badge>
              </div>
              <div class="mt-10 flex flex-wrap gap-x-14 gap-y-5 text-text-secondary text-12">
                <span>{server.toolsCount} tools</span><span>{server.resourcesCount} resources</span>
                <Show when={server.oauthStatus === 'authorized'}><span>Authorized</span></Show>
                <Show when={flow()?.status === 'failed'}><span class="text-danger">Authorization failed; you can retry</span></Show>
              </div>
              <div class="mt-13 flex flex-wrap gap-7">
                <Show when={server.oauthStatus === 'needs_authorization' && !server.activeFlowId}>
                  <Button variant="primary" class="max-[640px]:min-h-44 max-[640px]:flex-1" disabled={readOnly()} onClick={() => startMcpOAuth(server.name)}>Start authorization</Button>
                </Show>
                <Show when={server.activeFlowId && flow()?.status === 'authorization_needed'}>
                  <Button variant="primary" class="max-[640px]:min-h-44 max-[640px]:flex-1" disabled={readOnly()} onClick={() => requestMcpAuthorization(server.activeFlowId!)}>Get authorization link</Button>
                  <Button class="max-[640px]:min-h-44 max-[640px]:flex-1" disabled={readOnly()} onClick={() => cancelMcpOAuth(server.activeFlowId!)}>Cancel authorization</Button>
                </Show>
                <Show when={exactAuthorization()}>{(grant) => <a class="inline-flex min-h-36 items-center justify-center gap-8 rounded-8 border border-transparent bg-btn-primary px-12 text-14 font-500 text-surface no-underline cursor-pointer [transition:background_120ms_ease,border-color_120ms_ease,color_120ms_ease,transform_120ms_ease,opacity_120ms_ease] hover:bg-btn-primary-hover active:translate-y-1 pointer-coarse:min-h-44 max-[640px]:min-h-44 max-[640px]:flex-1" href={grant().authorizationUrl} target="_blank" rel="noopener noreferrer">Open authorization page</a>}</Show>
              </div>
              <Show when={exactAuthorization()}><InlineNotice class="mt-10" tone="info">The authorization URL is kept in memory for this page only and expires soon. After opening it, come back here to check the connection result.</InlineNotice></Show>
            </article>;
          }}</For>
        </div>
      </Show>
      <Show when={readOnly()}><InlineNotice class="mt-16" tone="info">Read-only sign-in can view MCP status but cannot start, read or cancel authorizations.</InlineNotice></Show>
    </section>;
}
