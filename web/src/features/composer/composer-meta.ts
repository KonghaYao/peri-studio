import type { TokenUsageMeterProps } from '@peri/ui';
import type { AgentInfo } from '@/entities/chat/control-view';
import type { InstanceInfo, MachineInfo, ProjectInfo } from '@/entities/registry/registry-view';
import type { RepositoryState } from '@/features/resource/resource-state';
import { instanceGroupName } from '@/features/session/instance-groups';

/** 主仓库分支名；无仓库投影时返回 null。 */
export function composerBranchLabel(repositories: readonly RepositoryState[]): string | null {
  const repo = repositories[0];
  if (!repo) return null;
  if (repo.detached) return 'detached HEAD';
  return repo.headName ?? 'No commits yet';
}

/** 当前 project 绑定的 instance / machine 展示名。 */
export function composerMachineLabel(
  project: Pick<ProjectInfo, 'instanceId'> | null,
  instances: readonly InstanceInfo[],
  machines: readonly MachineInfo[],
): string | null {
  if (!project) return null;
  const instance = instances.find((row) => row.id === project.instanceId);
  return instanceGroupName(project.instanceId, instance, machines);
}

/** Token 圆环 props；优先精确 tokenStats，否则回退 context used/window。 */
export function composerUsageMeterProps(agent: AgentInfo | null): TokenUsageMeterProps | null {
  if (!agent) return null;
  const limit = agent.contextWindow ?? 200_000;

  if (agent.extensions.includes('peri.tokenStats') && agent.latestUsage) {
    const { inputTokens, outputTokens, cacheReadTokens } = agent.latestUsage;
    if (inputTokens !== null && outputTokens !== null) {
      return {
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
        },
        contextWindow: limit,
      };
    }
  }

  if (agent.contextUsed !== null && agent.contextWindow !== null && agent.contextWindow > 0) {
    return {
      input: agent.contextUsed,
      output: 0,
      cached: 0,
      limit: agent.contextWindow,
    };
  }

  return null;
}
