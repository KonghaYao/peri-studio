import { Show } from 'solid-js';
import { Monitor, MoreHorizontal } from 'lucide-solid';
import type { InstanceInfo, MachineInfo } from '@/entities/registry/registry-view';
import { asAccessor, read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';
import {
  canConnectMachine,
  canDisconnectMachine,
  canRemoveMachine,
  canRenameMachine,
  canRestoreMachine,
  canSetMachineAutoReconnect,
  canStopMachine,
  canTrustMachineHost,
  isLocalMachine,
  isMachinePipelinePhase,
  machineDestinationLine,
  machineErrorCopy,
  machinePipelineProgressLabel,
  machinePrimaryAction,
  machinePrimaryActionLabel,
  machineRowStatusLabel,
  machineRowStatusLive,
  machineRowStatusTone,
  machineSshCommand,
} from '@/entities/machine/machine-view';
import {
  Button,
  CopyButton,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  InlineNotice,
  Status,
} from '@peri/ui';
import { cn } from '@peri/ui';

interface MachineRowProps {
  machine: MachineInfo;
  instances: MaybeAccessor<InstanceInfo[]>;
  readOnly: MaybeAccessor<boolean>;
  highlighted?: MaybeAccessor<boolean>;
  showOnlineHint?: boolean;
  onPrimaryAction: (action: NonNullable<ReturnType<typeof machinePrimaryAction>>) => void;
  onOpenTrust: () => void;
  onRename: () => void;
  onDisconnect: () => void;
  onConnect: () => void;
  onStop: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onToggleAutoReconnect: (enabled: boolean) => void;
}

export function MachineRow(props: MachineRowProps) {
  const instances = () => asAccessor(props.instances)();
  const readOnly = () => read(props.readOnly);
  const highlighted = () => read(props.highlighted ?? false);
  const primary = () => machinePrimaryAction(props.machine.phase);
  const error = () => machineErrorCopy(props.machine.errorCode);
  const sshCommand = () => machineSshCommand(props.machine);

  const runPrimary = () => {
    const action = primary();
    if (!action || readOnly()) return;
    if (action === 'trust') {
      props.onOpenTrust();
      return;
    }
    props.onPrimaryAction(action);
  };

  return <li
    class={cn(
      'mb-6 rounded-8 border px-10 py-8',
      highlighted() ? 'border-accent bg-surface-overlay' : 'border-border-faint',
    )}
    data-instance-id={props.machine.instanceId}
  >
    <div class="flex items-start gap-8">
      <Monitor size={15} strokeWidth={1.7} class="mt-2 shrink-0 text-text-muted" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-8">
          <p class="m-0 min-w-0 flex-1 font-600 text-text-primary">{props.machine.displayName}</p>
          <Status tone={machineRowStatusTone(props.machine, instances())} live={machineRowStatusLive(props.machine)}>
            {machineRowStatusLabel(props.machine, instances())}
          </Status>
          <Show when={primary()}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={readOnly()}
              onClick={runPrimary}
            >
              {machinePrimaryActionLabel(primary()!)}
            </Button>
          </Show>
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger
              as={IconButton}
              size="sm"
              showTooltip={false}
              label={`${props.machine.displayName} actions`}
              class="shrink-0 text-text-muted"
            >
              <MoreHorizontal size={15} strokeWidth={1.7} />
            </DropdownMenuTrigger>
            <DropdownMenuContent class="ui-menu min-w-180" aria-label={`${props.machine.displayName} actions`}>
              <Show when={isLocalMachine(props.machine)} fallback={<>
                <DropdownMenuItem disabled={!canRenameMachine(props.machine) || readOnly()} onSelect={props.onRename}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canDisconnectMachine(props.machine) || readOnly()}
                  onSelect={props.onDisconnect}
                >
                  Disconnect tunnel
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canConnectMachine(props.machine) || readOnly()}
                  onSelect={props.onConnect}
                >
                  Connect
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canStopMachine(props.machine) || readOnly()} onSelect={props.onStop}>
                  Stop agents
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canRemoveMachine(props.machine) || readOnly()} onSelect={props.onRemove}>
                  Remove from Peri
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={props.machine.autoReconnect}
                  disabled={!canSetMachineAutoReconnect(props.machine) || readOnly()}
                  onChange={(checked) => props.onToggleAutoReconnect(checked)}
                >
                  Auto-reconnect
                </DropdownMenuCheckboxItem>
              </>}>
                <DropdownMenuItem disabled>This is the computer running Peri.</DropdownMenuItem>
              </Show>
              <Show when={canRestoreMachine(props.machine)}>
                <DropdownMenuItem disabled={readOnly()} onSelect={props.onRestore}>Restore</DropdownMenuItem>
              </Show>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p class="m-0 mt-4 text-10 text-text-muted">
          {isLocalMachine(props.machine) ? 'Built-in' : machineDestinationLine(props.machine)}
        </p>
        <Show when={canTrustMachineHost(props.machine) && readOnly()}>
          <p class="m-0 mt-6 text-10 text-text-muted">Waiting for the owner to trust this host.</p>
        </Show>
        <Show when={isMachinePipelinePhase(props.machine.phase) && !canTrustMachineHost(props.machine)}>
          <p class="m-0 mt-6 text-10 text-text-secondary" aria-live="polite">
            {machinePipelineProgressLabel(props.machine.phase)}
          </p>
        </Show>
        <Show when={props.machine.phase === 'failed' && error()}>
          {(copy) => <div class="mt-8 flex flex-col gap-8">
            <InlineNotice tone="danger">{copy().message}</InlineNotice>
            <Show when={copy().hint}>
              <p class="m-0 text-10 text-text-muted">{copy().hint}</p>
            </Show>
            <Show when={copy().showCopySsh || copy().showCopySshAddHint}>
              <div class="flex flex-wrap items-center gap-6">
                <code class="rounded-6 bg-surface-overlay px-8 py-4 font-mono text-10 text-text-secondary">{sshCommand()}</code>
                <CopyButton text={sshCommand()} label="Copy ssh command" copiedLabel="Command copied" />
              </div>
            </Show>
          </div>}
        </Show>
        <Show when={props.showOnlineHint}>
          <p class="m-0 mt-8 text-10 text-text-secondary">
            Agents keep running after disconnect. Use Stop agents to shut them down.
          </p>
        </Show>
      </div>
    </div>
  </li>;
}
