import type { Component } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../../lib/cn';
import { Badge, type BadgeTone } from '../Badge';
import type { GitGraphRef } from './types';

function toneForRef(gitRef: GitGraphRef): BadgeTone {
  if (gitRef.tone === 'tag' || gitRef.tone === 'remote') return 'neutral';
  return 'info';
}

export type GitGraphRefBadgeProps = {
  gitRef: GitGraphRef;
  active?: boolean;
  class?: string;
};

/** Git Graph ref 标签：复用设计系统 Badge。 */
export const GitGraphRefBadge: Component<GitGraphRefBadgeProps> = (props) => {
  const [local, rest] = splitProps(props, ['gitRef', 'active', 'class']);
  return (
    <Badge
      tone={toneForRef(local.gitRef)}
      class={cn(
        'mr-4 h-18 shrink-0 px-6 text-10',
        local.active && '[&>span:first-child]:ring-2 [&>span:first-child]:ring-accent/40',
        local.class,
      )}
      {...rest}
    >
      <span class={cn(local.gitRef.tone === 'remote' && 'italic', local.active && 'font-650')}>
        {local.gitRef.label}
      </span>
    </Badge>
  );
};
