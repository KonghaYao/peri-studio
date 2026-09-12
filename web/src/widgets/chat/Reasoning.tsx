import { Show } from 'solid-js';
import { cn } from '@peri/ui';
import { Skeleton } from '@peri/ui';

/** 流式 thinking gap：扫光 Skeleton，不用 “Thinking” 文案行（ui-specification §5）。 */
function ThinkingGap() {
  return (
    <div
      class="thinking-gap relative z-1 flex max-w-(--chat-reasoning-max) flex-col gap-8 py-4 pl-32"
      data-testid="thinking-gap"
      aria-hidden="true"
    >
      <Skeleton class="h-12 w-180 max-w-full" />
      <Skeleton class="h-12 w-240 max-w-full" />
      <Skeleton class="h-12 w-100 max-w-full" />
    </div>
  );
}

/** Reasoning 正文默认折叠；activity 变体与工具 icon 共用连续轨道。 */
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
      fallback={<div class="reasoning-empty-track min-h-8" data-testid="reasoning-empty-track" aria-hidden="true" />}
    >
      <Show when={showThinkingGap()} fallback={(
        <details
          class={cn(
            'message-reasoning max-w-(--chat-reasoning-max) font-normal text-content-secondary',
            activity() && 'message-reasoning--activity',
          )}
          data-testid="message-reasoning"
        >
          <summary
            class={cn(
              'relative z-1 inline-flex min-h-24 cursor-pointer list-none items-center text-11 font-normal tracking-wide text-content-muted hover:text-content-secondary',
              activity() && 'min-h-16 pl-32',
              !hasText() && !props.streaming && 'cursor-default hover:text-content-muted',
            )}
          >
            <Show when={props.streaming && !hasText()} fallback="Reasoning">
              Reasoning…
            </Show>
          </summary>
          <Show when={hasText()}>
            <p
              class={cn(
                'message-reasoning__body m-0 mt-4 whitespace-pre-wrap text-12 font-normal leading-normal text-content-secondary',
                activity() && 'message-reasoning__body--activity-rail relative z-1 pl-32',
              )}
            >
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
