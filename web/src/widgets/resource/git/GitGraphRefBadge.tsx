import { Badge, type BadgeTone } from '@peri/ui';
import { cn } from '@peri/ui';
import type { GitGraphRef } from './types';

function toneForRef(gitRef: GitGraphRef): BadgeTone {
  if (gitRef.tone === 'tag' || gitRef.tone === 'remote') return 'neutral';
  return 'info';
}

/** Git Graph ref 标签：复用设计系统 Badge。 */
export function GitGraphRefBadge(props: { gitRef: GitGraphRef; active?: boolean }) {
  return (
    <Badge
      tone={toneForRef(props.gitRef)}
      class={cn(
        'mr-4 h-18 shrink-0 px-6 text-10',
        props.active && '[&>span:first-child]:ring-2 [&>span:first-child]:ring-accent/40',
      )}
    >
      <span class={cn(props.gitRef.tone === 'remote' && 'italic', props.active && 'font-650')}>
        {props.gitRef.label}
      </span>
    </Badge>
  );
}
