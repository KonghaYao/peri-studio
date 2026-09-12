import { Show, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Skeleton } from './Skeleton';

function ThinkingGap() {
  return (
    <div
      class="relative z-1 flex max-w-(--chat-reasoning-max) flex-col gap-8 py-8 pl-32"
      data-slot="transcript-reasoning-gap"
      aria-hidden="true"
    >
      <Skeleton class="h-12 w-180" />
      <Skeleton class="h-12 w-240" />
      <Skeleton class="h-12 w-210" />
    </div>
  );
}

type TranscriptReasoningProps = Omit<ComponentProps<'details'>, 'children'> & {
  children: string;
  variant?: 'default' | 'activity';
  streaming?: boolean;
};

/** Transcript 内推理摘要折叠块（对齐 blocks Reasoning；与 AI Elements `Reasoning` 并存）。 */
export const TranscriptReasoning: Component<TranscriptReasoningProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'variant', 'streaming']);
  const activity = () => local.variant === 'activity';
  const hasText = () => local.children.trim().length > 0;
  const showThinkingGap = () => activity() && !hasText() && local.streaming;
  const showEmptyTrack = () => activity() && !hasText() && !local.streaming;

  return (
    <Show
      when={!showEmptyTrack()}
      fallback={<div class="min-h-8" data-slot="transcript-reasoning-empty" aria-hidden="true" />}
    >
      <Show
        when={showThinkingGap()}
        fallback={(
          <details
            class={cn(
              'ui-transcript-reasoning max-w-(--chat-reasoning-max) font-normal text-content-secondary',
              activity() && 'ui-transcript-reasoning--activity',
              local.class,
            )}
            data-slot="transcript-reasoning"
            {...rest}
          >
            <summary
              class={cn(
                'relative z-1 inline-flex min-h-24 cursor-pointer list-none items-center text-11 font-normal tracking-wide text-content-muted hover:text-content-secondary',
                activity() && 'min-h-16 pl-32',
              )}
            >
              Reasoning
            </summary>
            <Show when={hasText()}>
              <p
                class={cn(
                  'ui-transcript-reasoning__body m-0 mt-16 whitespace-pre-wrap text-12 font-normal leading-normal text-content-secondary',
                  activity() && 'relative z-1 pl-32',
                )}
              >
                {local.children}
              </p>
            </Show>
          </details>
        )}
      >
        <ThinkingGap />
      </Show>
    </Show>
  );
};
