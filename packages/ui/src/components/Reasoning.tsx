import { Brain, ChevronDown } from 'lucide-solid';
import {
  createContext,
  createEffect,
  onCleanup,
  Show,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { disclosureContentMotion } from '../lib/overlay-motion';
import { createControllableSignal } from '../lib/controllable-state';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';
import { Shimmer } from './Shimmer';
import { Skeleton } from './Skeleton';

type ReasoningAppearance = 'panel' | 'transcript';
type ReasoningVariant = 'default' | 'activity';

interface ReasoningContextValue {
  appearance: Accessor<ReasoningAppearance>;
  variant: Accessor<ReasoningVariant>;
  isStreaming: Accessor<boolean>;
  isOpen: Accessor<boolean>;
  setIsOpen: (open: boolean) => void;
  duration: Accessor<number | undefined>;
  transcriptText: () => string;
}

const ReasoningContext = createContext<ReasoningContextValue>();

export function useReasoning() {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return context;
}

const AUTO_CLOSE_DELAY_MS = 1000;

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

type ReasoningRootProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  duration?: number;
  /** 流式结束后自动折叠；默认 true。 */
  autoClose?: boolean;
  /** 自动折叠延迟（毫秒）；默认 1000。 */
  autoCloseDelay?: number;
  /** panel = Brain + Collapsible；transcript = chat details 折叠。 */
  appearance?: ReasoningAppearance;
  /** transcript 模式下的活动轨对齐变体。 */
  variant?: ReasoningVariant;
  /** transcript 模式正文；用于 thinking gap / empty track 判定。 */
  text?: string;
};

export const Reasoning: Component<ReasoningRootProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'isStreaming',
    'duration',
    'open',
    'defaultOpen',
    'onOpenChange',
    'autoClose',
    'autoCloseDelay',
    'appearance',
    'variant',
    'text',
  ]);
  const appearance = () => local.appearance ?? 'panel';
  const variant = () => local.variant ?? 'default';
  const transcriptText = () => local.text ?? '';
  const isStreaming = () => local.isStreaming ?? false;
  const autoCloseEnabled = () => local.autoClose ?? true;
  const autoCloseDelay = () => local.autoCloseDelay ?? AUTO_CLOSE_DELAY_MS;
  const resolvedDefaultOpen = () => local.defaultOpen ?? isStreaming();
  const isExplicitlyClosed = () => local.defaultOpen === false;

  const [isOpen, setIsOpen] = createControllableSignal<boolean>({
    prop: () => local.open,
    defaultProp: resolvedDefaultOpen(),
    onChange: local.onOpenChange,
  });

  const [duration, setDuration] = createControllableSignal<number | undefined>({
    prop: () => local.duration,
    defaultProp: undefined,
  });

  let hasEverStreamed = false;
  let hasAutoClosed = false;
  let userCollapsedDuringStream = false;
  let startTime: number | null = null;

  createEffect(() => {
    if (isStreaming()) {
      hasEverStreamed = true;
      if (startTime === null) {
        startTime = Date.now();
      }
      return;
    }

    if (startTime !== null) {
      setDuration(Math.ceil((Date.now() - startTime) / 1000));
      startTime = null;
    }
  });

  createEffect(() => {
    if (!isStreaming()) {
      userCollapsedDuringStream = false;
    }
  });

  createEffect(() => {
    if (isStreaming() && !isOpen() && !isExplicitlyClosed() && !userCollapsedDuringStream) {
      setIsOpen(true);
    }
  });

  const handleOpenChange = (open: boolean) => {
    if (!open && isStreaming()) {
      userCollapsedDuringStream = true;
    }
    if (open) {
      userCollapsedDuringStream = false;
    }
    setIsOpen(open);
    local.onOpenChange?.(open);
  };

  createEffect(() => {
    if (
      !autoCloseEnabled()
      || !hasEverStreamed
      || isStreaming()
      || !isOpen()
      || hasAutoClosed
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsOpen(false);
      hasAutoClosed = true;
    }, autoCloseDelay());

    onCleanup(() => window.clearTimeout(timer));
  });

  const context: ReasoningContextValue = {
    appearance,
    variant,
    isStreaming,
    isOpen,
    setIsOpen,
    duration,
    transcriptText,
  };

  const activity = () => variant() === 'activity';
  const hasText = () => transcriptText().trim().length > 0;
  const showThinkingGap = () => appearance() === 'transcript' && activity() && !hasText() && isStreaming();
  const showEmptyTrack = () => appearance() === 'transcript' && activity() && !hasText() && !isStreaming();

  return (
    <ReasoningContext.Provider value={context}>
      <Show
        when={appearance() === 'panel'}
        fallback={(
          <Show
            when={!showEmptyTrack()}
            fallback={<div class="reasoning-empty-track min-h-8" data-testid="reasoning-empty-track" aria-hidden="true" />}
          >
            <Show when={showThinkingGap()} fallback={(
              <details
                class={cn(
                  'message-reasoning max-w-(--chat-reasoning-max) font-normal text-content-secondary',
                  activity() && 'message-reasoning--activity',
                  local.class,
                )}
                data-testid="message-reasoning"
                data-slot="reasoning"
              >
                {local.children}
              </details>
            )}>
              <ThinkingGap />
            </Show>
          </Show>
        )}
      >
        <Collapsible
          data-slot="reasoning"
          class={cn('mb-16 w-full max-w-full', local.class)}
          open={isOpen()}
          onOpenChange={handleOpenChange}
          {...rest}
        >
          {local.children}
        </Collapsible>
      </Show>
    </ReasoningContext.Provider>
  );
};

type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  shimmerClass?: string;
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => JSX.Element;
};

const defaultGetThinkingMessage = (
  streaming: boolean,
  duration?: number,
  shimmerClass?: string,
): JSX.Element => {
  if (streaming || duration === 0) {
    return (
      <Shimmer as="span" duration={1} spread={2} class={shimmerClass}>
        Thinking...
      </Shimmer>
    );
  }
  if (duration === undefined) {
    return <span class="text-content-muted">Thought for a few seconds</span>;
  }
  return <span class="text-content-muted">{`Thought for ${duration} seconds`}</span>;
};

export const ReasoningTrigger: Component<ReasoningTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'shimmerClass', 'getThinkingMessage']);
  const { appearance, variant, isStreaming, duration, isOpen, transcriptText } = useReasoning();
  const message = () =>
    (local.getThinkingMessage
      ?? ((streaming, value) => defaultGetThinkingMessage(streaming, value, local.shimmerClass)))(
      isStreaming(),
      duration(),
    );
  const activity = () => variant() === 'activity';
  const hasText = () => transcriptText().trim().length > 0;

  if (appearance() === 'transcript') {
    return (
      <summary
        data-slot="reasoning-trigger"
        class={cn(
          'relative z-1 inline-flex min-h-24 cursor-pointer list-none items-center text-11 font-normal tracking-wide text-content-muted hover:text-content-secondary',
          activity() && 'min-h-16 pl-32',
          !hasText() && !isStreaming() && 'cursor-default hover:text-content-muted',
          local.class,
        )}
        {...rest}
      >
        {local.children ?? (
          <Show when={isStreaming() && !hasText()} fallback="Reasoning">
            Reasoning…
          </Show>
        )}
      </summary>
    );
  }

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      class={cn(
        'ui-reasoning-trigger flex w-full cursor-pointer items-center gap-8 border-0 bg-transparent py-4 text-left text-13 text-content-muted transition-colors duration-120 outline-none hover:text-content-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? (
        <>
          <Brain size={16} strokeWidth={1.7} class="size-16 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 text-left">{message()}</span>
          <ChevronDown
            size={16}
            strokeWidth={1.7}
            class={cn(
              'shrink-0 text-content-muted transition-transform duration-120',
              isOpen() ? 'rotate-180' : 'rotate-0',
            )}
            aria-hidden="true"
          />
        </>
      )}
    </CollapsibleTrigger>
  );
};

export const ReasoningContent: Component<ComponentProps<typeof CollapsibleContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { appearance, variant, transcriptText } = useReasoning();
  const activity = () => variant() === 'activity';
  const hasText = () => transcriptText().trim().length > 0;

  if (appearance() === 'transcript') {
    return (
      <Show when={hasText()}>
        <p
          data-slot="reasoning-content"
          class={cn(
            'message-reasoning__body m-0 mt-4 whitespace-pre-wrap text-12 font-normal leading-normal text-content-secondary',
            activity() && 'message-reasoning__body--activity-rail relative z-1 pl-32',
            local.class,
          )}
          {...rest}
        >
          {local.children}
        </p>
      </Show>
    );
  }

  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      class={cn(
        'mt-16 overflow-hidden text-13 leading-normal text-content-muted',
        disclosureContentMotion,
        local.class,
      )}
      {...rest}
    >
      <div class="whitespace-pre-wrap pb-8 pt-4">{local.children}</div>
    </CollapsibleContent>
  );
};
