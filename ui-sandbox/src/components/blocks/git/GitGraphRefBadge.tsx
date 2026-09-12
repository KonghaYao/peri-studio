import { Badge, type BadgeTone } from '@/lib/catalog-ui';
import { cn } from '@/lib/catalog-ui';
import type { GitGraphRef } from './types';

function toneForRef(gitRef: GitGraphRef): BadgeTone {
  if (gitRef.tone === 'tag' || gitRef.tone === 'remote') return 'neutral';
  return 'info';
}

/** Git Graph ref 标签：直接复用设计系统 Badge，不改默认尺寸。 */
export function GitGraphRefBadge(props: { gitRef: GitGraphRef; active?: boolean }) {
  return (
    <Badge
      tone={toneForRef(props.gitRef)}
      class={cn('shrink-0', props.active && 'git-ref-badge--active')}
    >
      <span class={cn(props.gitRef.tone === 'remote' && 'italic', props.active && 'font-semibold')}>
        {props.gitRef.label}
      </span>
    </Badge>
  );
}
