import type { AgentCommandInfo } from '@/entities/chat/control-view';
import type { SlashMenuItem } from '@peri/ui';

function kindDividerAfter(item: AgentCommandInfo, next?: AgentCommandInfo) {
  if (!next) return false;
  if (item.kind === 'command' && next.kind !== 'command') return true;
  if (item.kind === 'skill' && next.kind === 'mcp_skill') return true;
  return false;
}

/** 将 ACP catalog 项映射为 @peri/ui SlashMenuItem。 */
export function agentCommandToSlashMenuItem(item: AgentCommandInfo, next?: AgentCommandInfo): SlashMenuItem {
  return {
    name: item.name,
    description: item.description,
    kind: item.kind,
    accent: item.kind === 'skill',
    dividerAfter: kindDividerAfter(item, next),
  };
}
