import { ChevronsUpDown } from 'lucide-solid';
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
import { Shimmer } from './Shimmer';
import { createControllableSignal } from '../lib/controllable-state';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './Card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';

interface PlanContextValue {
  isStreaming: Accessor<boolean>;
  isOpen: Accessor<boolean>;
  setIsOpen: (open: boolean) => void;
}

const PlanContext = createContext<PlanContextValue>();

function usePlan(component: string) {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error(`${component} must be used within Plan`);
  }
  return context;
}

type PlanRootProps = ComponentProps<'div'> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const Plan: Component<PlanRootProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'isStreaming',
    'open',
    'defaultOpen',
    'onOpenChange',
  ]);
  const [isOpen, setIsOpen] = createControllableSignal<boolean>({
    prop: () => local.open,
    defaultProp: local.defaultOpen ?? true,
    onChange: local.onOpenChange,
  });
  const isStreaming = () => local.isStreaming ?? false;

  const context: PlanContextValue = { isStreaming, isOpen, setIsOpen };

  return (
    <PlanContext.Provider value={context}>
      <Collapsible open={isOpen()} onOpenChange={setIsOpen}>
        <Card
          data-slot="plan"
          class={cn(
            'mb-8 w-full overflow-hidden rounded-12 border border-border-subtle bg-surface-overlay',
            local.class,
          )}
          {...rest}
        >
          {local.children}
        </Card>
      </Collapsible>
    </PlanContext.Provider>
  );
};

export const PlanHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CardHeader
      data-slot="plan-header"
      class={cn('flex items-start justify-between gap-8', local.class)}
      {...rest}
    >
      {local.children}
    </CardHeader>
  );
};

type PlanTitleProps = Omit<ComponentProps<typeof CardTitle>, 'children'> & {
  children: string;
};

export const PlanTitle: Component<PlanTitleProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { isStreaming } = usePlan('PlanTitle');

  return (
    <CardTitle data-slot="plan-title" class={local.class} {...rest}>
      {isStreaming() ? (
        <Shimmer duration={1} spread={2}>{local.children}</Shimmer>
      ) : (
        local.children
      )}
    </CardTitle>
  );
};

type PlanDescriptionProps = Omit<ComponentProps<typeof CardDescription>, 'children'> & {
  children: string;
};

export const PlanDescription: Component<PlanDescriptionProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { isStreaming } = usePlan('PlanDescription');

  return (
    <CardDescription
      data-slot="plan-description"
      class={cn('text-balance', local.class)}
      {...rest}
    >
      {isStreaming() ? (
        <Shimmer duration={1} spread={2}>{local.children}</Shimmer>
      ) : (
        local.children
      )}
    </CardDescription>
  );
};

export const PlanAction: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div data-slot="plan-action" class={cn('flex shrink-0 items-start', local.class)} {...rest}>
      {local.children}
    </div>
  );
};

export const PlanTrigger: Component<ComponentProps<typeof CollapsibleTrigger>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <CollapsibleTrigger
      data-slot="plan-trigger"
      class={cn(
        'inline-flex size-32 shrink-0 cursor-pointer items-center justify-center rounded-6 border-0 bg-transparent text-content-muted transition-colors duration-120 outline-none hover:bg-interaction-hover hover:text-content-secondary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      <ChevronsUpDown size={16} strokeWidth={1.7} aria-hidden="true" />
      <span class="sr-only">Toggle plan</span>
    </CollapsibleTrigger>
  );
};

export const PlanContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CollapsibleContent as="div">
      <CardContent data-slot="plan-content" class={local.class} {...rest}>
        {local.children}
      </CardContent>
    </CollapsibleContent>
  );
};

export const PlanFooter: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CardFooter data-slot="plan-footer" class={local.class} {...rest}>
      {local.children}
    </CardFooter>
  );
};

export type PlanStepStatus = 'complete' | 'active' | 'pending';

const stepStatusClasses: Record<PlanStepStatus, string> = {
  active: 'text-content-primary',
  complete: 'text-content-secondary',
  pending: 'text-content-muted opacity-60',
};

type PlanStepProps = ComponentProps<'div'> & {
  label: JSX.Element;
  description?: JSX.Element;
  status?: PlanStepStatus;
};

/** Peri 扩展：带状态指示的计划步骤时间线。 */
export const PlanStep: Component<PlanStepProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'label', 'description', 'status', 'children']);
  const status = () => local.status ?? 'pending';

  return (
    <div
      data-slot="plan-step"
      data-status={status()}
      class={cn('ui-plan-step flex gap-8 text-12', stepStatusClasses[status()], local.class)}
      {...rest}
    >
      <div class="relative mt-2 shrink-0">
        <span
          class={cn(
            'block size-8 rounded-full border-2',
            status() === 'complete' && 'border-success bg-success',
            status() === 'active' && 'animate-pulse border-accent bg-accent',
            status() === 'pending' && 'border-border-strong bg-transparent',
          )}
          aria-hidden="true"
        />
        <div
          class="ui-plan-step-connector absolute top-12 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border-subtle"
          aria-hidden="true"
        />
      </div>
      <div class="min-w-0 flex-1 space-y-4 overflow-hidden pb-8">
        <div class="font-medium">{local.label}</div>
        {local.description && <div class="text-11 text-content-muted">{local.description}</div>}
        {local.children}
      </div>
    </div>
  );
};
