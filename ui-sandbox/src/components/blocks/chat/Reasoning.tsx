import { Show } from 'solid-js';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui';

function ThinkingGap() {
  return (
    <div class="relative z-1 flex max-w-(--chat-reasoning-max) flex-col gap-2 py-2 pl-8" data-testid="thinking-gap" aria-hidden="true">
      <Skeleton class="h-3 w-40" />
      <Skeleton class="h-3 w-56" />
      <Skeleton class="h-3 w-48" />
    </div>
  );
}

/** 推理摘要默认折叠；activity 变体与工具 icon 共用连续轨道。 */
export function Reasoning(props: {
  children: string;
  variant?: 'default' | 'activity';
  streaming?: boolean;
}) {
  const activity = () => props.variant === 'activity';
  const hasText = () => props.children.trim().length > 0;
  const showThinkingGap = () => activity() && !hasText() && props.streaming;
  const showEmptyTrack = () => activity() && !hasText() && !props.streaming;

  return (
    <Show
      when={!showEmptyTrack()}
      fallback={<div class="min-h-2" data-testid="reasoning-empty-track" aria-hidden="true" />}
    >
      <Show when={showThinkingGap()} fallback={(
        <details
          class={cn(
            'message-reasoning max-w-(--chat-reasoning-max) font-normal text-content-secondary',
            activity() && 'message-reasoning--activity',
          )}
          data-testid="message-reasoning"
        >
          <summary class={cn(
            'relative z-1 inline-flex min-h-6 cursor-pointer list-none items-center text-11 font-normal tracking-wide text-content-muted hover:text-content-secondary',
            activity() && 'min-h-4 pl-8',
          )}>
            Reasoning
          </summary>
          <Show when={hasText()}>
            <p class={cn(
              'message-reasoning__body m-0 mt-4 whitespace-pre-wrap text-12 font-normal leading-normal text-content-secondary',
              activity() && 'relative z-1 pl-8',
            )}>
              {props.children}
            </p>
          </Show>
        </details>
      )}>
        <ThinkingGap />
      </Show>
    </Show>
  );
}
