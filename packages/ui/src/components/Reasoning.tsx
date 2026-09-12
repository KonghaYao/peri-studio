import { Brain, ChevronDown } from 'lucide-solid';
import {
  createContext,
  createEffect,
  onCleanup,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { createControllableSignal } from '../lib/controllable-state';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';

interface ReasoningContextValue {
  isStreaming: Accessor<boolean>;
  isOpen: Accessor<boolean>;
  setIsOpen: (open: boolean) => void;
  duration: Accessor<number | undefined>;
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

type ReasoningRootProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  duration?: number;
  /** 流式结束后自动折叠；默认 true。 */
  autoClose?: boolean;
  /** 自动折叠延迟（毫秒）；默认 1000。 */
  autoCloseDelay?: number;
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
  ]);

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
    isStreaming,
    isOpen,
    setIsOpen,
    duration,
  };

  return (
    <ReasoningContext.Provider value={context}>
      <Collapsible
        data-slot="reasoning"
        class={cn('mb-8 w-full max-w-full', local.class)}
        open={isOpen()}
        onOpenChange={handleOpenChange}
        {...rest}
      >
        {local.children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
};

type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  shimmerClass?: string;
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => JSX.Element;
};

const defaultGetThinkingMessage = (streaming: boolean, duration?: number): JSX.Element => {
  if (streaming || duration === 0) {
    return <>Thinking</>;
  }
  if (duration === undefined) {
    return <span>Thought for a few seconds</span>;
  }
  return <span>{`Thought for ${duration} seconds`}</span>;
};

export const ReasoningTrigger: Component<ReasoningTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'shimmerClass', 'getThinkingMessage']);
  const { isStreaming, duration } = useReasoning();
  const message = () => (local.getThinkingMessage ?? defaultGetThinkingMessage)(isStreaming(), duration());

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      class={cn(
        'ui-reasoning-trigger flex w-full cursor-pointer items-center gap-8 border-0 bg-transparent py-4 text-left text-12 text-content-muted transition-colors duration-120 outline-none hover:text-content-secondary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? (
        <>
          <Brain size={14} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
          <span class={cn(isStreaming() ? local.shimmerClass ?? 'ui-reasoning-shimmer' : undefined, 'min-w-0 flex-1')}>
            {message()}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.7}
            class="ui-reasoning-chevron shrink-0 text-content-muted"
            aria-hidden="true"
          />
        </>
      )}
    </CollapsibleTrigger>
  );
};

export const ReasoningContent: Component<ComponentProps<typeof CollapsibleContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      class={cn('overflow-hidden text-12 text-content-secondary transition-all duration-120 ease-in-out', local.class)}
      {...rest}
    >
      <div class="pb-8 pt-4 whitespace-pre-wrap leading-normal">{local.children}</div>
    </CollapsibleContent>
  );
};
