import type { InstanceInfo, ProjectInfo } from './registry-view';

export interface MachineGroup {
  id: string;
  name: string;
  offline: boolean;
  projects: ProjectInfo[];
}

const sameProjects = (left: readonly ProjectInfo[], right: readonly ProjectInfo[]) => left.length === right.length
  && left.every((project, index) => project === right[index]);

/** 以 machine id 结构共享侧栏分组，避免无关 heartbeat 重挂 session 子树。 */
export function reconcileMachineGroups(
  instances: readonly InstanceInfo[],
  projects: readonly ProjectInfo[],
  previous: readonly MachineGroup[],
): MachineGroup[] {
  const grouped = new Map<string, MachineGroup>();
  for (const instance of instances) {
    grouped.set(instance.id, {
      id: instance.id,
      name: instance.hostname || instance.id,
      offline: instance.status === 'offline',
      projects: [],
    });
  }
  for (const project of projects) {
    const machine = grouped.get(project.instanceId) ?? {
      id: project.instanceId,
      name: project.instanceId || 'Machine',
      offline: false,
      projects: [],
    };
    machine.projects.push(project);
    grouped.set(project.instanceId, machine);
  }
  const previousById = new Map(previous.map((machine) => [machine.id, machine]));
  const next = [...grouped.values()].map((machine) => {
    const existing = previousById.get(machine.id);
    if (!existing || existing.name !== machine.name || existing.offline !== machine.offline) return machine;
    if (!sameProjects(existing.projects, machine.projects)) return machine;
    return existing;
  });
  return next.length === previous.length && next.every((machine, index) => machine === previous[index])
    ? previous as MachineGroup[]
    : next;
}
