import { ChevronsUpDown, ListTodo } from 'lucide-solid';
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
import { createControllableSignal } from '../lib/controllable-state';
import { Card, CardHeader } from './Card';
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
      <Card data-slot="plan" class={cn('mb-8 w-full overflow-hidden', local.class)} {...rest}>
        {local.children}
      </Card>
    </PlanContext.Provider>
  );
};

export const PlanHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { isStreaming, isOpen, setIsOpen } = usePlan('PlanHeader');

  return (
    <Collapsible open={isOpen()} onOpenChange={setIsOpen}>
      <CardHeader data-slot="plan-header" class={cn('flex-row items-center gap-8 py-10', local.class)} {...rest}>
        <CollapsibleTrigger
          class={cn(
            'ui-plan-trigger flex min-w-0 flex-1 cursor-pointer items-center gap-8 border-0 bg-transparent p-0 text-left transition-colors duration-120 outline-none',
            'hover:text-content-secondary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
          )}
        >
          <ListTodo size={14} strokeWidth={1.7} class="shrink-0 text-content-muted" aria-hidden="true" />
          <span
            class={cn(
              'min-w-0 flex-1 text-13 font-semibold text-content-primary',
              isStreaming() && 'shimmer',
            )}
          >
            {local.children ?? 'Plan'}
          </span>
          <ChevronsUpDown
            size={14}
            strokeWidth={1.7}
            class="ui-plan-chevron shrink-0 text-content-muted"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
      </CardHeader>
    </Collapsible>
  );
};

export const PlanContent: Component<ComponentProps<typeof CollapsibleContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { isOpen } = usePlan('PlanContent');

  return (
    <Collapsible open={isOpen()}>
      <CollapsibleContent
        data-slot="plan-content"
        class={cn('border-t border-border-subtle px-16 py-10', local.class)}
        {...rest}
      >
        <div class="space-y-8">{local.children}</div>
      </CollapsibleContent>
    </Collapsible>
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
            status() === 'active' && 'border-accent bg-accent animate-pulse',
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
