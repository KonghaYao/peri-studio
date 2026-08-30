// peri-studio Web 面板 —— 拓扑视图组装（只读）。
//
// 消费 registry 投影（registry-view.ts）的 instances/chats，输出
// server → instance → chats 三级树的 instance 层节点。纯函数、无副作用，
// 便于单测与组件渲染分离。chat 按 instance_id 归属；孤儿 chat
// （instance 已离线摘除）不进入任何节点。

import type { ChatInfo, InstanceInfo } from '@/entities/registry/registry-view';

/** 拓扑树 instance 节点：实例信息 + 其下挂载的 chats（按 id 字典序）。 */
export interface TopologyInstanceNode extends InstanceInfo {
  chats: ChatInfo[];
}

/** 把 registry 投影分组为拓扑树的 instance 层。 */
export function buildTopologyTree(
  instances: InstanceInfo[],
  chats: ChatInfo[],
): TopologyInstanceNode[] {
  return instances
    .map((instance) => ({
      ...instance,
      chats: chats
        .filter((chat) => chat.instanceId === instance.id && chat.status !== 'gap')
        .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

/** instance 状态展示文案（与 server registry.rs instance_status_str 对齐）。 */
export function instanceStatusLabel(status: string | null): string {
  switch (status) {
    case 'online':
      return 'Online';
    case 'offline':
      return 'Offline';
    case 'unknown':
      return 'Unknown';
    default:
      return status || 'Unknown';
  }
}

/** chat 状态展示文案（与 proto ChatStatus 对齐）。 */
export function chatStatusLabel(status: string | null): string {
  switch (status) {
    case 'accepting':
      return 'Accepting';
    case 'active':
      return 'Running';
    case 'ended':
      return 'Ended';
    case 'closed':
      return 'Closed';
    case 'crashed':
      return 'Crashed';
    default:
      return status || 'Unknown';
  }
}

/** server 全局健康状态文案（与 proto GlobalStatus 对齐）。 */
export function serverStatusLabel(status: string | null): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'restarting':
      return 'Restarting';
    default:
      return status || 'Unknown';
  }
}
