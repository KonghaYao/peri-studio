import { Show } from 'solid-js';
import { GitBranch } from 'lucide-solid';
import { cn } from '@/lib/cn';

function SyncAction(props: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      class={cn(
        'flex min-h-8 flex-1 items-center justify-center rounded-md text-11 text-content-muted transition-colors duration-(--duration-fast)',
        'hover:bg-interaction-hover hover:text-content-primary',
        'disabled:cursor-not-allowed disabled:opacity-45',
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

/** 仓库头：对齐 sidebar workspace 行密度。 */
export function GitBranchBar(props: {
  repoName: string;
  branch: string;
  ahead?: number;
  behind?: number;
  root?: string;
  hasUpstream?: boolean;
  readOnly?: boolean;
  busy?: boolean;
}) {
  const syncMeta = () => (props.ahead ?? 0) + (props.behind ?? 0) > 0;
  const disabled = () => props.readOnly || props.busy || !props.hasUpstream;

  return (
    <div class="px-1.5 pb-1 pt-1">
      <div
        class="flex min-h-8 items-center gap-2 rounded-md px-2.5"
        title={props.root}
      >
        <GitBranch size={15} strokeWidth={1.7} class="shrink-0 text-content-muted" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-13 text-content-primary">{props.repoName}</span>
        <span class="max-w-24 truncate font-mono text-11 text-content-muted">{props.branch}</span>
      </div>
      <Show when={syncMeta()}>
        <p class="px-2.5 pb-0.5 text-11 text-content-muted">
          ↑ {props.ahead ?? 0} · ↓ {props.behind ?? 0}
        </p>
      </Show>
      <div class="mt-0.5 flex items-center gap-0.5 px-1.5">
        <SyncAction label="Pull" disabled={disabled()} />
        <SyncAction label="Sync" disabled={disabled()} />
        <SyncAction label="Push" disabled={disabled()} />
      </div>
    </div>
  );
}
