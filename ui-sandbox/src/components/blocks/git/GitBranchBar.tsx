import { Show } from 'solid-js';
import { GitBranch } from 'lucide-solid';
import { cn } from '@/lib/catalog-ui';

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
        'flex min-h-36 flex-1 items-center justify-center rounded-md text-11 text-content-muted transition-colors duration-(--duration-fast)',
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
    <div class="px-6 pb-4 pt-4">
      <div
        class="flex min-h-36 items-center gap-8 rounded-md px-10"
        title={props.root}
      >
        <GitBranch size={15} strokeWidth={1.7} class="shrink-0 text-content-muted" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-13 text-content-primary">{props.repoName}</span>
        <span class="max-w-96 truncate font-mono text-11 text-content-muted">{props.branch}</span>
      </div>
      <Show when={syncMeta()}>
        <p class="px-10 pb-2 text-11 text-content-muted">
          ↑ {props.ahead ?? 0} · ↓ {props.behind ?? 0}
        </p>
      </Show>
      <div class="mt-2 flex items-center gap-2 px-6">
        <SyncAction label="Pull" disabled={disabled()} />
        <SyncAction label="Sync" disabled={disabled()} />
        <SyncAction label="Push" disabled={disabled()} />
      </div>
    </div>
  );
}
