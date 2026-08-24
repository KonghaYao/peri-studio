import type { InstanceInfo, ProjectInfo } from './registry-view';

export interface InstanceGroup {
  id: string;
  name: string;
  offline: boolean;
  projects: ProjectInfo[];
}

const sameProjects = (left: readonly ProjectInfo[], right: readonly ProjectInfo[]) => left.length === right.length
  && left.every((project, index) => project === right[index]);

/** 以 instance id 结构共享侧栏分组，避免无关 heartbeat 重挂 session 子树。 */
export function reconcileInstanceGroups(
  instances: readonly InstanceInfo[],
  projects: readonly ProjectInfo[],
  previous: readonly InstanceGroup[],
): InstanceGroup[] {
  const grouped = new Map<string, InstanceGroup>();
  for (const instance of instances) {
    grouped.set(instance.id, {
      id: instance.id,
      name: instance.hostname || instance.id,
      offline: instance.status === 'offline',
      projects: [],
    });
  }
  for (const project of projects) {
    const instance = grouped.get(project.instanceId) ?? {
      id: project.instanceId,
      name: project.instanceId || 'Instance',
      offline: false,
      projects: [],
    };
    instance.projects.push(project);
    grouped.set(project.instanceId, instance);
  }
  const previousById = new Map(previous.map((instance) => [instance.id, instance]));
  const next = [...grouped.values()].map((instance) => {
    const existing = previousById.get(instance.id);
    if (!existing || existing.name !== instance.name || existing.offline !== instance.offline) return instance;
    if (!sameProjects(existing.projects, instance.projects)) return instance;
    return existing;
  });
  return next.length === previous.length && next.every((instance, index) => instance === previous[index])
    ? previous as InstanceGroup[]
    : next;
}
