// peri-studio Web 面板 —— 拓扑关系视图（只读）。
//
// 三级拓扑：server（registry 根节点）→ instance（注册表实例）→ chats。
// 数据全部来自 hub:registry 投影（store 信号），无任何操作入口；
// token_id 为脱敏标识，不展示 token 本体。

import { For, Show } from 'solid-js';
import { Badge, EmptyState, type BadgeTone } from '@/shared/ui';
import { chatCatalog, globalStatus, instances, schemaVersion } from '@/store';
import { messageTime } from '@/shared/lib/message-time';
import {
  buildTopologyTree,
  chatStatusLabel,
  instanceStatusLabel,
  serverStatusLabel,
} from '@/entities/topology/topology-view';

const INSTANCE_TONE: Record<string, BadgeTone> = { online: 'ok', offline: 'err' };
const CHAT_TONE: Record<string, BadgeTone> = {
  accepting: 'ok',
  active: 'ok',
  ended: 'neutral',
  closed: 'neutral',
  crashed: 'err',
};
const SERVER_TONE: Record<string, BadgeTone> = {
  healthy: 'ok',
  degraded: 'warn',
  restarting: 'warn',
};

export function TopologyView() {
  const nodes = () => buildTopologyTree(instances(), chatCatalog());
  return (
    <Show
      when={nodes().length > 0}
      fallback={
        <EmptyState
          title="No instance connections"
          description="Peri Studio has not received any instance registrations yet. After starting dev.sh or connecting an instance, the topology of server and instances will appear here."
        />
      }
    >
      <div class="grid gap-8 mt-14">
        <article class="border border-divider rounded-12 bg-surface">
          <div class="flex items-center gap-10 px-14 py-12">
            <span class="w-9 h-9 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <div class="grid min-w-0 flex-1 gap-2">
              <strong class="overflow-hidden text-text-primary text-14 text-ellipsis whitespace-nowrap">Peri Studio server</strong>
              <span class="overflow-hidden text-text-muted font-mono text-11 text-ellipsis whitespace-nowrap">hub:registry · schema {String(schemaVersion() ?? '—')}</span>
            </div>
            <Badge tone={SERVER_TONE[globalStatus()] ?? 'neutral'}>{serverStatusLabel(globalStatus())}</Badge>
          </div>
        </article>
        <For each={nodes()}>{(node) => {
          const registered = () => messageTime(node.registeredAt);
          const heartbeat = () => messageTime(node.lastHeartbeat);
          return (
            <article class="border border-divider rounded-12 bg-surface-muted">
              <div class="flex items-center gap-10 px-14 py-12">
                <span class="w-9 h-9 shrink-0 rounded-full bg-success" aria-hidden="true" />
                <div class="grid min-w-0 flex-1 gap-2">
                  <strong class="overflow-hidden text-text-primary text-14 text-ellipsis whitespace-nowrap">{node.hostname || node.id}</strong>
                  <span class="overflow-hidden text-text-muted font-mono text-11 text-ellipsis whitespace-nowrap">{node.id} · token {node.tokenId || '—'}</span>
                </div>
                <Badge tone={INSTANCE_TONE[node.status ?? ''] ?? 'neutral'}>{instanceStatusLabel(node.status)}</Badge>
              </div>
              <div class="flex flex-wrap gap-x-14 gap-y-5 px-14 pb-11 text-text-secondary text-12">
                <span>{node.chats.length} conversations</span>
                <span>Registered {registered()?.label ?? '—'}</span>
                <span>Last heartbeat {heartbeat()?.label ?? '—'}</span>
              </div>
              <Show when={node.chats.length > 0}>
                <ul class="topology-instance-children grid gap-2 mx-14 mb-11 pt-7 pl-13 border-t border-dashed border-l-2 border-solid-l border-divider list-none">
                  <For each={node.chats}>{(chat) => (
                    <li class="flex items-center gap-8 px-6 py-4 rounded-8 hover:bg-hover">
                      <span class="min-w-0 overflow-hidden flex-1 text-text-primary text-12p5 text-ellipsis whitespace-nowrap">{chat.title || chat.id}</span>
                      <span class="overflow-hidden max-w-2/5 text-text-muted font-mono text-10p5 text-ellipsis whitespace-nowrap">{chat.id}</span>
                      <Badge tone={CHAT_TONE[chat.status ?? ''] ?? 'neutral'}>{chatStatusLabel(chat.status)}</Badge>
                    </li>
                  )}</For>
                </ul>
              </Show>
            </article>
          );
        }}</For>
      </div>
    </Show>
  );
}
