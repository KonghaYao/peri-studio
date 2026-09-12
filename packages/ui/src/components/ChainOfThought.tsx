import { Brain, ChevronDown, Circle } from 'lucide-solid';
import {
  createContext,
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

interface ChainOfThoughtContextValue {
  isOpen: Accessor<boolean>;
  setIsOpen: (open: boolean) => void;
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue>();

function useChainOfThought(component: string) {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(`${component} must be used within ChainOfThought`);
  }
  return context;
}

type ChainOfThoughtRootProps = ComponentProps<'div'> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought: Component<ChainOfThoughtRootProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'open', 'defaultOpen', 'onOpenChange']);
  const [isOpen, setIsOpen] = createControllableSignal<boolean>({
    prop: () => local.open,
    defaultProp: local.defaultOpen ?? false,
    onChange: local.onOpenChange,
  });

  const context: ChainOfThoughtContextValue = { isOpen, setIsOpen };

  return (
    <ChainOfThoughtContext.Provider value={context}>
      <div data-slot="chain-of-thought" class={cn('mb-8 w-full space-y-8', local.class)} {...rest}>
        {local.children}
      </div>
    </ChainOfThoughtContext.Provider>
  );
};

export const ChainOfThoughtHeader: Component<ComponentProps<typeof CollapsibleTrigger>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { isOpen, setIsOpen } = useChainOfThought('ChainOfThoughtHeader');

  return (
    <Collapsible open={isOpen()} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        data-slot="chain-of-thought-header"
        class={cn(
          'ui-chain-of-thought-trigger flex w-full cursor-pointer items-center gap-8 border-0 bg-transparent py-4 text-left text-12 text-content-muted transition-colors duration-120 outline-none hover:text-content-secondary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
          local.class,
        )}
        {...rest}
      >
        <Brain size={14} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-left">{local.children ?? 'Chain of Thought'}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.7}
          class="ui-chain-of-thought-chevron shrink-0 text-content-muted"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
    </Collapsible>
  );
};

export type ChainOfThoughtStepStatus = 'complete' | 'active' | 'pending';

type ChainOfThoughtStepProps = ComponentProps<'div'> & {
  icon?: JSX.Element;
  label: JSX.Element;
  description?: JSX.Element;
  status?: ChainOfThoughtStepStatus;
};

const stepStatusClasses: Record<ChainOfThoughtStepStatus, string> = {
  active: 'text-content-primary',
  complete: 'text-content-secondary',
  pending: 'text-content-muted opacity-60',
};

export const ChainOfThoughtStep: Component<ChainOfThoughtStepProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'icon', 'label', 'description', 'status', 'children']);
  const status = () => local.status ?? 'complete';

  return (
    <div
      data-slot="chain-of-thought-step"
      data-status={status()}
      class={cn(
        'ui-chain-of-thought-step flex gap-8 text-12',
        'fade-in-0 slide-in-from-top-2 animate-in motion-reduce:animate-none',
        stepStatusClasses[status()],
        local.class,
      )}
      {...rest}
    >
      <div class="relative mt-2 shrink-0">
        {local.icon ?? <Circle size={14} strokeWidth={1.7} class="text-content-muted" aria-hidden="true" />}
        <div class="ui-chain-of-thought-connector absolute top-20 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border-subtle" aria-hidden="true" />
      </div>
      <div class="min-w-0 flex-1 space-y-8 overflow-hidden pb-8">
        <div class="font-medium">{local.label}</div>
        {local.description && <div class="text-11 text-content-muted">{local.description}</div>}
        {local.children}
      </div>
    </div>
  );
};

export const ChainOfThoughtSearchResults: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="chain-of-thought-search-results"
      class={cn('flex flex-wrap items-center gap-8', local.class)}
      {...rest}
    />
  );
};

export const ChainOfThoughtSearchResult: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <span
      data-slot="chain-of-thought-search-result"
      class={cn(
        'inline-flex h-20 items-center rounded-full border border-border-strong bg-surface px-8 text-11 font-normal text-text-secondary',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </span>
  );
};

export const ChainOfThoughtContent: Component<ComponentProps<typeof CollapsibleContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { isOpen } = useChainOfThought('ChainOfThoughtContent');

  return (
    <Collapsible open={isOpen()}>
      <CollapsibleContent
        data-slot="chain-of-thought-content"
        class={cn(
          'mt-8 space-y-12 overflow-hidden text-content-secondary',
          disclosureContentMotion,
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </CollapsibleContent>
    </Collapsible>
  );
};

type ChainOfThoughtImageProps = ComponentProps<'div'> & {
  caption?: string;
};

export const ChainOfThoughtImage: Component<ChainOfThoughtImageProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'caption']);
  return (
    <div data-slot="chain-of-thought-image" class={cn('mt-8 space-y-8', local.class)} {...rest}>
      <div class="ui-chain-of-thought-image-frame relative flex items-center justify-center overflow-hidden rounded-8 bg-surface-muted p-12">
        {local.children}
      </div>
      {local.caption && <p class="text-11 text-content-muted">{local.caption}</p>}
    </div>
  );
};
