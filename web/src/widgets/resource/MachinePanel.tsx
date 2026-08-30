import { For, Show } from 'solid-js';
import { ChevronDown, MessageSquare, Monitor, Server } from 'lucide-solid';
import { connState } from '../../panel/lib/connection';
import { buildTopologyTree, chatStatusLabel, instanceStatusLabel, serverStatusLabel } from '@/entities/topology/topology-view';
import { chatCatalog, globalStatus, instances, schemaVersion } from '../../panel/store';

/** 与 Files / Git 共用 24px 树行；机器拓扑只读，不再嵌入独立卡片面板。 */
export function MachinePanel() {
  const nodes = () => buildTopologyTree(instances(), chatCatalog());
  return <section class="ui-scrollbar min-h-0 flex-1 overflow-auto bg-surface" aria-label="Machines">
    <div class="resource-section-title flex h-28 items-center border-b border-divider px-8 text-10 font-650 uppercase tracking-6 text-text-secondary pointer-coarse:h-44">
      <span>Runtime</span>
      <span class="ml-auto max-w-(--runtime-label-max) overflow-hidden text-ellipsis whitespace-nowrap font-mono text-9 font-normal normal-case tracking-normal text-text-muted" title={connState().text}>{connState().text}</span>
    </div>
    <div role="tree" aria-label="Machine topology" class="py-2 text-11">
      <div role="treeitem" aria-level="1" aria-expanded="true" class="flex h-(--tree-row-height) items-center gap-5 rounded-4 px-7 font-600 text-text-primary hover:bg-hover pointer-coarse:h-44" title={`Schema ${String(schemaVersion() ?? '—')}`}>
        <ChevronDown size={14} strokeWidth={1.7} class="text-text-muted" />
        <Server size={15} strokeWidth={1.7} class="text-text-muted" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">Peri Studio</span>
        <StatusDot status={globalStatus()} />
        <span class="text-9 font-normal text-text-muted">{serverStatusLabel(globalStatus())}</span>
      </div>
      <Show when={nodes().length > 0} fallback={<p class="m-0 px-26 py-7 text-10 text-text-muted">No machines connected</p>}>
        <div role="group">
          <For each={nodes()}>{(node) => <>
            <div role="treeitem" aria-level="2" aria-expanded="true" class="flex h-(--tree-row-height) items-center gap-5 rounded-4 pr-7 pl-19 text-text-primary hover:bg-hover pointer-coarse:h-44" title={node.id}>
              <ChevronDown size={14} strokeWidth={1.7} class="text-text-muted" />
              <Monitor size={15} strokeWidth={1.7} class="text-text-muted" />
              <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-600">{node.hostname || node.id}</span>
              <StatusDot status={node.status ?? ''} />
              <span class="text-9 text-text-muted">{instanceStatusLabel(node.status)}</span>
            </div>
            <Show when={node.chats.length > 0}><div role="group">
              <For each={node.chats}>{(chat) => <div role="treeitem" aria-level="3" class="flex h-(--tree-row-height) items-center gap-5 rounded-4 pr-7 pl-(--tree-depth-chat) text-text-primary hover:bg-hover pointer-coarse:h-44" title={chat.id}>
                <MessageSquare size={14} strokeWidth={1.7} class="shrink-0 text-text-muted" />
                <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{chat.title || chat.id}</span>
                <StatusDot status={chat.status ?? ''} />
                <span class="text-9 text-text-muted">{chatStatusLabel(chat.status)}</span>
              </div>}</For>
            </div></Show>
          </>}</For>
        </div>
      </Show>
    </div>
  </section>;
}

function StatusDot(props: { status: string }) {
  const tone = () => props.status === 'healthy' || props.status === 'online' || props.status === 'active' || props.status === 'accepting'
    ? 'bg-success'
    : props.status === 'degraded' || props.status === 'restarting'
      ? 'bg-warning'
      : props.status === 'offline' || props.status === 'crashed'
        ? 'bg-danger'
        : 'bg-text-faint';
  return <span class={`size-5 shrink-0 rounded-full ${tone()}`} aria-hidden="true" />;
}
