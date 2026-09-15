import { createMemo, splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { Tag, type TagProps } from './tag/Tag';

const DEFAULT_STATUS_COLORS: Record<string, TagProps['color']> = {
  healthy: 'success',
  cooldown: 'warning',
  disabled: 'neutral',
  error: 'danger',
  failed: 'danger',
  pending: 'processing',
};

export type StatusPillProps = {
  status: string;
  toneMap?: Record<string, TagProps['color']>;
  class?: string;
};

/** T2 · Compact filled status pill for tables and provider rows. */
export const StatusPill: Component<StatusPillProps> = (props) => {
  const [local, rest] = splitProps(props, ['status', 'toneMap', 'class']);
  const color = createMemo(() => {
    const key = local.status.toLowerCase();
    const map = local.toneMap ?? DEFAULT_STATUS_COLORS;
    return map[key] ?? 'default';
  });

  return (
    <Tag
      {...rest}
      variant="filled"
      color={color()}
      class={cn('rounded-full text-11 capitalize', local.class)}
    >
      {local.status}
    </Tag>
  );
};
