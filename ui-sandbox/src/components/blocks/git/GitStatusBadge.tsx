import { cn } from '@/lib/catalog-ui';
import type { GitChangeStatus } from './types';

const STATUS_META: Record<GitChangeStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-success-solid' },
  modified: { letter: 'M', className: 'text-warning-strong' },
  deleted: { letter: 'D', className: 'text-danger-solid' },
  renamed: { letter: 'R', className: 'text-warning-strong' },
  copied: { letter: 'C', className: 'text-success-solid' },
  untracked: { letter: 'U', className: 'text-success-solid' },
  conflict: { letter: '!', className: 'text-danger-solid' },
};

/** Git 变更状态字母：与 VS Code SCM 语义一致。 */
export function GitStatusBadge(props: { status: GitChangeStatus }) {
  const meta = () => STATUS_META[props.status];
  return (
    <span
      class={cn('w-14 shrink-0 text-center font-mono text-11 font-semibold tabular-nums', meta().className)}
      aria-label={props.status}
    >
      {meta().letter}
    </span>
  );
}
