import { Show } from 'solid-js';
import { Minus, Plus, Trash2 } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import { ButtonGroup, buttonGroupItemClass } from '../ButtonGroup';
import type { GitChange, GitChangeGroupId, GitChangeStatus } from './types';

const STATUS_TAIL: Record<GitChangeStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-content-muted' },
  modified: { letter: 'M', className: 'text-content-muted' },
  deleted: { letter: 'D', className: 'text-danger-solid' },
  renamed: { letter: 'R', className: 'text-content-muted' },
  copied: { letter: 'C', className: 'text-content-muted' },
  untracked: { letter: 'U', className: 'text-content-muted' },
  conflict: { letter: '!', className: 'text-danger-solid' },
};

const META_HIDE = {
  'tree-file': 'group-hover/tree-file:opacity-0 group-focus-within/tree-file:opacity-0',
  row: 'group-hover/row:opacity-0 group-focus-within/row:opacity-0',
} as const;

const ACTIONS_SHOW = {
  'tree-file':
    'group-hover/tree-file:pointer-events-auto group-hover/tree-file:opacity-100 group-focus-within/tree-file:pointer-events-auto group-focus-within/tree-file:opacity-100',
  row: 'group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100',
} as const;

/** 变更行右侧：状态字母与 ButtonGroup 叠层，对齐侧栏 RowAccessory。 */
export function GitChangeActions(props: {
  change: Pick<GitChange, 'path' | 'status'>;
  groupId: GitChangeGroupId;
  hoverGroup: keyof typeof META_HIDE;
  busy?: boolean;
  disabled?: boolean;
  onStageToggle?: (event: MouseEvent) => void;
  onDiscard?: (event: MouseEvent) => void;
}) {
  const staged = () => props.groupId === 'index';
  const discardable = () => props.groupId === 'working_tree' || props.groupId === 'untracked';
  const stageLabel = () => (staged() ? 'Unstage' : 'Stage');
  const tail = () => STATUS_TAIL[props.change.status];

  return (
    <span class={cn('relative flex h-28 shrink-0 items-center justify-end', discardable() ? 'w-56' : 'w-28')}>
      <span
        class={cn(
          'font-mono text-10 tabular-nums transition-opacity duration-(--duration-fast)',
          tail().className,
          META_HIDE[props.hoverGroup],
          'pointer-coarse:opacity-0',
        )}
        aria-label={props.change.status}
      >
        {tail().letter}
      </span>
      <ButtonGroup
        aria-label={`${props.change.path} actions`}
        class={cn(
          'absolute inset-0 justify-end opacity-0 pointer-events-none transition-opacity duration-(--duration-fast)',
          ACTIONS_SHOW[props.hoverGroup],
          'focus-within:pointer-events-auto focus-within:opacity-100',
          'pointer-coarse:pointer-events-auto pointer-coarse:opacity-100',
        )}
      >
        <Show when={discardable()}>
          <IconButton
            size="sm"
            showTooltip={false}
            label={`Discard ${props.change.path}`}
            disabled={props.disabled}
            class={cn(buttonGroupItemClass, 'text-content-muted hover:text-danger-solid')}
            onClick={(event) => {
              event.stopPropagation();
              props.onDiscard?.(event);
            }}
          >
            <Trash2 size={14} strokeWidth={1.7} />
          </IconButton>
        </Show>
        <IconButton
          size="sm"
          showTooltip={false}
          label={`${stageLabel()} ${props.change.path}`}
          busy={props.busy}
          disabled={props.disabled}
          class={buttonGroupItemClass}
          onClick={(event) => {
            event.stopPropagation();
            props.onStageToggle?.(event);
          }}
        >
          {staged() ? <Minus size={14} strokeWidth={1.7} /> : <Plus size={14} strokeWidth={1.7} />}
        </IconButton>
      </ButtonGroup>
    </span>
  );
}
