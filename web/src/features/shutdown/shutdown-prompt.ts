import { isTerminal } from '@/features/runtime/action-state';
import { isLocalMachine } from '@/entities/machine/machine-view';
import type { ChatInfo, InstanceInfo, MachineInfo, ProjectInfo, ProjectSessionInfo } from '@/entities/registry/registry-view';

export const QUIT_REQUEST_EVENT = 'peri:quit-request';
export const QUIT_CONFIRM_EVENT = 'peri:quit-confirm';

export interface ShutdownPromptInput {
  machines: readonly MachineInfo[];
  instances: readonly InstanceInfo[];
  chatCatalog: readonly ChatInfo[];
  chatStatuses: Readonly<Record<string, string>>;
  projects: readonly ProjectInfo[];
  projectSessions: readonly ProjectSessionInfo[];
}

export interface ShutdownPromptSummary {
  instanceIds: string[];
  displayNames: string[];
}

const sshInstanceIds = (machines: readonly MachineInfo[]): Set<string> => new Set(
  machines
    .filter((machine) => !isLocalMachine(machine) && !machine.archivedAt)
    .map((machine) => machine.instanceId),
);

export function collectNonTerminalSshRuntimes(input: ShutdownPromptInput): ShutdownPromptSummary {
  const sshIds = sshInstanceIds(input.machines);
  const live = new Set<string>();
  const projectById = new Map(input.projects.map((project) => [project.id, project]));

  for (const chat of input.chatCatalog) {
    if (!chat.instanceId || !sshIds.has(chat.instanceId)) continue;
    const status = input.chatStatuses[chat.id];
    if (status && !isTerminal(status)) live.add(chat.instanceId);
  }

  for (const session of input.projectSessions) {
    if (!session.activeChatId) continue;
    const project = projectById.get(session.projectId);
    if (!project || !sshIds.has(project.instanceId)) continue;
    const status = input.chatStatuses[session.activeChatId];
    if (status && !isTerminal(status)) live.add(project.instanceId);
  }

  const instanceIds = [...live];
  const displayNames = instanceIds.map((instanceId) => {
    const machine = input.machines.find((row) => row.instanceId === instanceId);
    return machine?.displayName || instanceId;
  });
  return { instanceIds, displayNames };
}

export function shouldPromptBeforeQuit(input: ShutdownPromptInput): boolean {
  return collectNonTerminalSshRuntimes(input).instanceIds.length > 0;
}

/** Server 尚无 shutdown API；以 health 探针作为未来开关的占位。 */
export async function checkServerShutdownSupported(): Promise<boolean> {
  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) return false;
    const body = await response.json() as { shutdown?: unknown };
    return body.shutdown === true;
  } catch {
    return false;
  }
}

export function requestApplicationQuit(): void {
  window.dispatchEvent(new CustomEvent(QUIT_REQUEST_EVENT));
}

export function confirmApplicationQuit(): void {
  window.dispatchEvent(new CustomEvent(QUIT_CONFIRM_EVENT));
}
