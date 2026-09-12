import { splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Skeleton } from '../Skeleton';

export interface TranscriptThinkingGapProps extends JSX.HTMLAttributes<HTMLDivElement> {
  'data-testid'?: string;
}

/** T3 · Transcript thinking-gap skeleton (agent working, no visible content yet). */
export const TranscriptThinkingGap: Component<TranscriptThinkingGapProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <div
      class={cn(
        'thinking-gap relative z-1 flex max-w-(--chat-reasoning-max) flex-col gap-8',
        local.class,
      )}
      data-testid={props['data-testid'] ?? 'message-loading'}
      aria-hidden="true"
      {...rest}
    >
      <Skeleton class="h-12 w-180 max-w-full" />
      <Skeleton class="h-12 w-240 max-w-full" />
      <Skeleton class="h-12 w-100 max-w-full" />
    </div>
  );
};
