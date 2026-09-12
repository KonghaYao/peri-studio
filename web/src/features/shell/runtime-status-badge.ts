import type { BadgeTone } from '@peri/ui';

const OK = ['online', 'healthy', 'completed', 'accepting', 'allow'];
const WARN = ['degraded', 'active', 'streaming', 'pending', 'awaitingPermission', 'running', 'deny'];
const ERR = ['offline', 'crashed', 'error', 'restarting', 'failed'];

/** 将 runtime / 连接状态字符串映射为 Badge tone。 */
export function runtimeStatusBadgeTone(status: string | null | undefined): BadgeTone {
  if (!status) return 'neutral';
  if (OK.includes(status)) return 'ok';
  if (WARN.includes(status)) return 'warn';
  if (ERR.includes(status)) return 'err';
  return 'neutral';
}
