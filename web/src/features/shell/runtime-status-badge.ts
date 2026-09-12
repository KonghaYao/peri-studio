import type { BadgeTone } from '@peri/ui';

const OK = ['online', 'healthy', 'completed', 'accepting', 'allow', 'active'];
const WARN = ['degraded', 'streaming', 'pending', 'awaitingPermission', 'running', 'deny', 'restarting'];
const ERR = ['offline', 'crashed', 'error', 'failed'];

/** 将 runtime / 连接状态字符串映射为 Badge tone。 */
export function runtimeStatusBadgeTone(status: string | null | undefined): BadgeTone {
  if (!status) return 'neutral';
  if (OK.includes(status)) return 'ok';
  if (WARN.includes(status)) return 'warn';
  if (ERR.includes(status)) return 'err';
  return 'neutral';
}

/** Settings 拓扑：server 健康状态。 */
export function topologyServerBadgeTone(status: string): BadgeTone {
  if (status === 'healthy') return 'ok';
  if (status === 'degraded' || status === 'restarting') return 'warn';
  return runtimeStatusBadgeTone(status);
}

/** Settings 拓扑：instance 在线状态。 */
export function topologyInstanceBadgeTone(status: string | null | undefined): BadgeTone {
  if (status === 'online') return 'ok';
  if (status === 'offline') return 'err';
  return runtimeStatusBadgeTone(status);
}

/** Settings 拓扑：chat 生命周期状态。 */
export function topologyChatBadgeTone(status: string | null | undefined): BadgeTone {
  if (status === 'accepting' || status === 'active') return 'ok';
  if (status === 'ended' || status === 'closed') return 'neutral';
  if (status === 'crashed') return 'err';
  return runtimeStatusBadgeTone(status);
}

/** MCP server 连接状态。 */
export function mcpConnectionBadgeTone(status: string): BadgeTone {
  if (status === 'connected') return 'ok';
  if (status === 'failed') return 'err';
  return 'neutral';
}
