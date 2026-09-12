import { Show } from 'solid-js';
import { cn } from '@/lib/catalog-ui';
import { Skeleton } from '@/lib/catalog-ui';

function ThinkingGap() {
  return (
    <div class="relative z-1 flex max-w-(--chat-reasoning-max) flex-col gap-8 py-8 pl-32" data-testid="thinking-gap" aria-hidden="true">
      <Skeleton class="h-12 w-180" />
      <Skeleton class="h-12 w-240" />
      <Skeleton class="h-12 w-210" />
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
      fallback={<div class="min-h-8" data-testid="reasoning-empty-track" aria-hidden="true" />}
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
            'relative z-1 inline-flex min-h-24 cursor-pointer list-none items-center text-11 font-normal tracking-wide text-content-muted hover:text-content-secondary',
            activity() && 'min-h-16 pl-32',
          )}>
            Reasoning
          </summary>
          <Show when={hasText()}>
            <p class={cn(
              'message-reasoning__body m-0 mt-16 whitespace-pre-wrap text-12 font-normal leading-normal text-content-secondary',
              activity() && 'relative z-1 pl-32',
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
