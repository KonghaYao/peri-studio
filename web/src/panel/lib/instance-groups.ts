import type { InstanceInfo, MachineInfo, ProjectInfo } from '@/entities/registry/registry-view';
import { isLocalMachine } from '@/entities/machine/machine-view';

export interface InstanceGroup {
  id: string;
  name: string;
  offline: boolean;
  projects: ProjectInfo[];
}

const sameProjects = (left: readonly ProjectInfo[], right: readonly ProjectInfo[]) => left.length === right.length
  && left.every((project, index) => project === right[index]);

export function instanceGroupName(
  instanceId: string,
  instance: InstanceInfo | undefined,
  machines: readonly MachineInfo[],
): string {
  const machine = machines.find((row) => row.instanceId === instanceId);
  if (machine?.displayName) return machine.displayName;
  return instance?.hostname || instanceId || 'Instance';
}

function instanceIsOffline(
  instanceId: string,
  instances: readonly InstanceInfo[],
): boolean {
  const live = instances.find((row) => row.id === instanceId);
  return live ? live.status === 'offline' : true;
}

/** 以 instance id 结构共享侧栏分组，避免无关 heartbeat 重挂 session 子树。 */
export function reconcileInstanceGroups(
  instances: readonly InstanceInfo[],
  projects: readonly ProjectInfo[],
  machines: readonly MachineInfo[],
  previous: readonly InstanceGroup[],
): InstanceGroup[] {
  const grouped = new Map<string, InstanceGroup>();

  // SSH-only groups：从 machines 投影种子化远端分组，即便尚无 project 也保留行。
  for (const machine of machines) {
    if (isLocalMachine(machine) || machine.archivedAt) continue;
    grouped.set(machine.instanceId, {
      id: machine.instanceId,
      name: machine.displayName,
      offline: instanceIsOffline(machine.instanceId, instances),
      projects: [],
    });
  }

  for (const instance of instances) {
    const existing = grouped.get(instance.id);
    grouped.set(instance.id, {
      id: instance.id,
      name: instanceGroupName(instance.id, instance, machines),
      offline: instance.status === 'offline',
      projects: existing?.projects ?? [],
    });
  }

  for (const project of projects) {
    const instance = grouped.get(project.instanceId) ?? {
      id: project.instanceId,
      name: instanceGroupName(
        project.instanceId,
        instances.find((row) => row.id === project.instanceId),
        machines,
      ),
      offline: instanceIsOffline(project.instanceId, instances),
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
