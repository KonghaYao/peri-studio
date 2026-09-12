import { Show } from 'solid-js';
import { ArrowDown, ArrowUp, GitBranch, RefreshCw } from 'lucide-solid';
import { ButtonGroup, buttonGroupItemClass } from '../ButtonGroup';
import { IconButton } from '../Button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';

export type GitSyncAction = 'pull' | 'push' | 'sync';

/** 仓库头：一行容纳仓库、分支、ahead/behind 与同步操作。 */
export function GitBranchBar(props: {
  repoName: string;
  branch: string;
  ahead?: number;
  behind?: number;
  root?: string;
  hasUpstream?: boolean;
  readOnly?: boolean;
  busy?: boolean;
  busyAction?: GitSyncAction;
  onPull?: () => void;
  onPush?: () => void;
  onSync?: () => void;
  pullTitle?: string;
  pushTitle?: string;
  syncTitle?: string;
}) {
  const ahead = () => props.ahead ?? 0;
  const behind = () => props.behind ?? 0;
  const syncDisabled = () => props.readOnly || props.busy || !props.hasUpstream;

  return (
    <div class="flex h-36 items-center gap-6 px-8">
      <GitBranch size={14} strokeWidth={1.7} class="shrink-0 text-content-muted" aria-hidden="true" />
      <Show
        when={props.root}
        fallback={<span class="min-w-0 truncate text-12 text-content-primary">{props.repoName}</span>}
      >
        <Tooltip>
          <TooltipTrigger as="span" class="min-w-0 truncate text-12 text-content-primary">
            {props.repoName}
          </TooltipTrigger>
          <TooltipContent>{props.root}</TooltipContent>
        </Tooltip>
      </Show>
      <span class="max-w-96 shrink-0 truncate font-mono text-11 text-content-muted">{props.branch}</span>
      <Show when={ahead() > 0}>
        <span class="shrink-0 tabular-nums text-10 text-content-muted">↑{ahead()}</span>
      </Show>
      <Show when={behind() > 0}>
        <span class="shrink-0 tabular-nums text-10 text-content-muted">↓{behind()}</span>
      </Show>
      <ButtonGroup aria-label="Repository sync" class="ml-auto">
        <IconButton
          size="sm"
          label="Pull from upstream"
          title={props.pullTitle}
          disabled={syncDisabled()}
          busy={props.busyAction === 'pull'}
          class={buttonGroupItemClass}
          onClick={() => props.onPull?.()}
        >
          <ArrowDown size={14} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          size="sm"
          label="Synchronize changes"
          title={props.syncTitle}
          disabled={syncDisabled()}
          busy={props.busyAction === 'sync'}
          class={buttonGroupItemClass}
          onClick={() => props.onSync?.()}
        >
          <RefreshCw size={14} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          size="sm"
          label="Push to upstream"
          title={props.pushTitle}
          disabled={syncDisabled()}
          busy={props.busyAction === 'push'}
          class={buttonGroupItemClass}
          onClick={() => props.onPush?.()}
        >
          <ArrowUp size={14} strokeWidth={1.7} />
        </IconButton>
      </ButtonGroup>
    </div>
  );
}
