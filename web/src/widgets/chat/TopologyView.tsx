// peri-studio Web 面板 —— 拓扑关系视图（只读）。
//
// 三级拓扑：server（registry 根节点）→ instance（注册表实例）→ chats。
// 数据全部来自 hub:registry 投影（store 信号），无任何操作入口；
// token_id 为脱敏标识，不展示 token 本体。

import { For, Show } from 'solid-js';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from '@peri/ui';
import {
  topologyChatBadgeTone,
  topologyInstanceBadgeTone,
  topologyServerBadgeTone,
} from '@/features/shell/runtime-status-badge';
import { chatCatalog, globalStatus, instances, schemaVersion } from '@/store';
import { messageTime } from '@/shared/lib/message-time';
import {
  buildTopologyTree,
  chatStatusLabel,
  instanceStatusLabel,
  serverStatusLabel,
} from '@/entities/topology/topology-view';

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
        <Card class="rounded-12 border-divider">
          <CardHeader class="flex-row items-center gap-10 px-14 py-12">
            <span class="w-9 h-9 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <div class="grid min-w-0 flex-1 gap-2">
              <CardTitle class="overflow-hidden text-ellipsis whitespace-nowrap">Peri Studio server</CardTitle>
              <CardDescription class="overflow-hidden font-mono text-11 text-text-muted text-ellipsis whitespace-nowrap">
                hub:registry · schema {String(schemaVersion() ?? '—')}
              </CardDescription>
            </div>
            <Badge tone={topologyServerBadgeTone(globalStatus())}>{serverStatusLabel(globalStatus())}</Badge>
          </CardHeader>
        </Card>
        <For each={nodes()}>{(node) => {
          const registered = () => messageTime(node.registeredAt);
          const heartbeat = () => messageTime(node.lastHeartbeat);
          return (
            <Card class="rounded-12 border-divider bg-surface-muted">
              <CardHeader class="flex-row items-center gap-10 px-14 py-12">
                <span class="w-9 h-9 shrink-0 rounded-full bg-success" aria-hidden="true" />
                <div class="grid min-w-0 flex-1 gap-2">
                  <CardTitle class="overflow-hidden text-ellipsis whitespace-nowrap">{node.hostname || node.id}</CardTitle>
                  <CardDescription class="overflow-hidden font-mono text-11 text-text-muted text-ellipsis whitespace-nowrap">
                    {node.id} · token {node.tokenId || '—'}
                  </CardDescription>
                </div>
                <Badge tone={topologyInstanceBadgeTone(node.status)}>{instanceStatusLabel(node.status)}</Badge>
              </CardHeader>
              <CardContent class="px-14 py-0">
                <div class="flex flex-wrap gap-x-14 gap-y-5 pb-11 text-text-secondary text-12">
                  <span>{node.chats.length} conversations</span>
                  <span>Registered {registered()?.label ?? '—'}</span>
                  <span>Last heartbeat {heartbeat()?.label ?? '—'}</span>
                </div>
                <Show when={node.chats.length > 0}>
                  <ItemGroup class="grid gap-2 mx-0 mb-11 pt-7 pl-13 border-t border-dashed border-l-2 border-solid-l border-divider">
                    <For each={node.chats}>{(chat) => (
                      <Item class="gap-8 px-6 py-4 hover:bg-hover">
                        <ItemContent class="min-w-0 flex-row items-center gap-8">
                          <ItemTitle class="min-w-0 overflow-hidden flex-1 text-12p5 text-text-primary text-ellipsis whitespace-nowrap">
                            {chat.title || chat.id}
                          </ItemTitle>
                          <span class="overflow-hidden max-w-2/5 text-text-muted font-mono text-10p5 text-ellipsis whitespace-nowrap">{chat.id}</span>
                        </ItemContent>
                        <ItemActions>
                          <Badge tone={topologyChatBadgeTone(chat.status)}>{chatStatusLabel(chat.status)}</Badge>
                        </ItemActions>
                      </Item>
                    )}</For>
                  </ItemGroup>
                </Show>
              </CardContent>
            </Card>
          );
        }}</For>
      </div>
    </Show>
  );
}
