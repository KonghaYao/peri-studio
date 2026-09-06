import type { InstanceInfo, MachineInfo } from '@/entities/registry/registry-view';

/** Registry `machines.phase` values that indicate an in-flight supply pipeline. */
export const MACHINE_PIPELINE_PHASES = new Set([
  'pending',
  'host_key_probe',
  'awaiting_host_key',
  'awaiting_replace',
  'ssh_connect',
  'probe',
  'install',
  'provision',
  'tunnel',
  'start',
  'connecting',
]);

export function isLocalMachine(machine: Pick<MachineInfo, 'kind'>): boolean {
  return machine.kind === 'local';
}

export function isArchivedMachine(machine: Pick<MachineInfo, 'archivedAt'>): boolean {
  return !!machine.archivedAt;
}

export function isMachinePipelinePhase(phase: string): boolean {
  return MACHINE_PIPELINE_PHASES.has(phase);
}

/** Primary status copy for machine rows (ssh-machine-mount §11.2). */
export function machinePhaseLabel(phase: string): string {
  switch (phase) {
    case 'pending':
    case 'host_key_probe':
    case 'ssh_connect':
    case 'probe':
      return 'Checking SSH…';
    case 'awaiting_host_key':
      return 'Trust this host to continue';
    case 'awaiting_replace':
      return 'Confirm replace to continue';
    case 'install':
      return 'Installing Peri Studio…';
    case 'downloading':
      return 'Downloading linux-x64 build…';
    case 'copying':
      return 'Copying Peri Studio…';
    case 'provision':
      return 'Copying Peri Studio…';
    case 'tunnel':
    case 'start':
      return 'Starting instance…';
    case 'connecting':
      return 'Waiting for instance…';
    case 'online':
      return 'Online';
    case 'offline':
      return 'Offline';
    case 'failed':
      return 'Failed';
    case 'removing':
      return 'Removing…';
    default:
      return phase || 'Unknown';
  }
}

/** Progress copy while a pipeline step is active (§11.2 pipeline row). */
export function machinePipelineProgressLabel(phase: string): string {
  if (phase === 'awaiting_host_key') return 'Waiting for you to trust this host…';
  if (phase === 'awaiting_replace') return 'Peri Studio is already installed on this computer. Confirm to replace it.';
  return machinePhaseLabel(phase);
}

export type MachinePrimaryAction = 'cancel' | 'trust' | 'disconnect' | 'connect' | 'retry';

export function machinePrimaryAction(phase: string): MachinePrimaryAction | null {
  if (isMachinePipelinePhase(phase)) {
    return phase === 'awaiting_host_key' ? 'trust' : 'cancel';
  }
  if (phase === 'online') return 'disconnect';
  if (phase === 'offline') return 'connect';
  if (phase === 'failed') return 'retry';
  return null;
}

export function canConnectMachine(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && machine.phase === 'offline';
}

export function canDisconnectMachine(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && machine.phase === 'online';
}

export function canStopMachine(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && (machine.phase === 'online' || machine.errorCode === 'connect_delivery_unknown');
}

export function canCancelMachine(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && isMachinePipelinePhase(machine.phase);
}

export function canRetryMachine(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && machine.phase === 'failed';
}

export function canTrustMachineHost(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && machine.phase === 'awaiting_host_key'
    && !!machine.hostKeySha256;
}

export function canRenameMachine(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && machine.phase !== 'removing';
}

export function canRemoveMachine(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && machine.phase === 'offline';
}

export function canRestoreMachine(machine: MachineInfo): boolean {
  return !isLocalMachine(machine) && isArchivedMachine(machine);
}

export function canSetMachineAutoReconnect(machine: MachineInfo): boolean {
  return !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && machine.phase !== 'removing';
}

export function machineDestinationLine(machine: Pick<MachineInfo, 'sshDestination' | 'sshPort'>): string {
  if (!machine.sshDestination) return '';
  return machine.sshPort ? `${machine.sshDestination}:${machine.sshPort}` : machine.sshDestination;
}

export function machineSshCommand(machine: Pick<MachineInfo, 'sshDestination' | 'sshPort'>): string {
  const destination = machine.sshDestination?.trim();
  if (!destination) return 'ssh';
  if (machine.sshPort) return `ssh -p ${machine.sshPort} ${destination}`;
  return `ssh ${destination}`;
}

export function isMachineLiveOnline(
  machine: Pick<MachineInfo, 'instanceId' | 'phase'>,
  instances: InstanceInfo[],
): boolean {
  const live = instances.find((row) => row.id === machine.instanceId);
  return live?.status === 'online' || machine.phase === 'online';
}

export function machineRowStatusLabel(machine: MachineInfo, instances: InstanceInfo[]): string {
  if (isLocalMachine(machine)) {
    return isMachineLiveOnline(machine, instances) ? 'Online' : 'Offline';
  }
  if (isMachineLiveOnline(machine, instances)) return 'Online';
  if (machine.phase === 'failed') return 'Failed';
  if (isMachinePipelinePhase(machine.phase) || machine.phase === 'removing') {
    return machinePhaseLabel(machine.phase);
  }
  return machinePhaseLabel(machine.phase);
}

export type MachineRowStatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export function machineRowStatusTone(machine: MachineInfo, instances: InstanceInfo[]): MachineRowStatusTone {
  if (isMachineLiveOnline(machine, instances)) return 'success';
  if (machine.phase === 'failed') return 'danger';
  if (machine.phase === 'awaiting_host_key') return 'warning';
  if (isMachinePipelinePhase(machine.phase) || machine.phase === 'removing') return 'info';
  return 'neutral';
}

export function machineRowStatusLive(machine: MachineInfo): boolean {
  return isMachinePipelinePhase(machine.phase) || machine.phase === 'removing';
}

export function machinePrimaryActionLabel(action: MachinePrimaryAction): string {
  switch (action) {
    case 'cancel':
      return 'Cancel';
    case 'trust':
      return 'Trust';
    case 'disconnect':
      return 'Disconnect tunnel';
    case 'connect':
      return 'Connect';
    case 'retry':
      return 'Retry';
  }
}

export interface MachineErrorCopy {
  message: string;
  hint?: string;
  showCopySsh?: boolean;
  showCopySshAddHint?: boolean;
  primaryAction?: 'retry' | 'stop-agents';
  closeHint?: string;
}

/** Failed-row copy aligned with ssh-machine-mount §11.3. */
export function machineErrorCopy(errorCode: string | null | undefined): MachineErrorCopy | null {
  switch (errorCode) {
    case 'ssh_auth_interactive_required':
      return {
        message: 'SSH needs a key in the agent on the computer running Peri.',
        hint: 'Run ssh-add, then retry.',
        showCopySshAddHint: true,
        showCopySsh: true,
        primaryAction: 'retry',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'ssh_auth_failed':
      return {
        message: 'SSH could not authenticate. Check the destination and keys on this computer.',
        showCopySsh: true,
        primaryAction: 'retry',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'ssh_host_key_mismatch':
      return {
        message: 'The host key changed. Peri refused to connect. Verify the host, then Remove from Peri and add it again.',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'ssh_connect_failed':
      return {
        message: 'Could not reach the SSH host. Check VPN, hostname, and port.',
        primaryAction: 'retry',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'tunnel_failed':
      return {
        message: 'Could not open an SSH tunnel. The host may disable TCP forwarding.',
        primaryAction: 'retry',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'instance_binary_unavailable':
      return {
        message: 'No Peri Studio build is available for that computer’s system (or checksums are missing).',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'instance_binary_install_failed':
      return {
        message: 'Could not install Peri Studio on that computer.',
        primaryAction: 'retry',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'hello_timeout':
      return {
        message: 'The remote instance did not connect in time.',
        primaryAction: 'retry',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'connect_delivery_unknown':
      return {
        message: 'The remote instance may already be running. Stop agents before retrying.',
        primaryAction: 'stop-agents',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'server_restarted':
      return {
        message: 'Peri restarted while adding this computer.',
        primaryAction: 'retry',
        closeHint: 'Keep this computer in the list to retry.',
      };
    case 'machine_has_live_runtime':
      return {
        message: 'Stop agents on this computer before removing it from Peri.',
        primaryAction: 'stop-agents',
      };
    case 'remote_os_unsupported':
      return {
        message: 'That computer’s operating system is not supported.',
        closeHint: 'Keep this computer in the list to retry.',
      };
    default:
      if (!errorCode) return null;
      return {
        message: 'Could not add this computer.',
        primaryAction: 'retry',
        closeHint: 'Keep this computer in the list to retry.',
      };
  }
}

export function sortMachinesForPanel(rows: MachineInfo[]): MachineInfo[] {
  return [...rows].sort((left, right) => {
    if (isLocalMachine(left) && !isLocalMachine(right)) return -1;
    if (!isLocalMachine(left) && isLocalMachine(right)) return 1;
    return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
  });
}

export function findActiveMachineByDestination(
  destination: string,
  port: number | undefined,
  rows: MachineInfo[],
): MachineInfo | undefined {
  const normalized = destination.trim();
  const targetPort = port ?? null;
  return rows.find((machine) => !isLocalMachine(machine)
    && !isArchivedMachine(machine)
    && machine.sshDestination?.trim() === normalized
    && (machine.sshPort ?? null) === targetPort);
}
