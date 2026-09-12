import {
  CheckCircle,
  ChevronDown,
  Circle,
  Clock,
  Wrench,
  XCircle,
} from 'lucide-solid';
import { Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { disclosureContentMotion } from '../lib/overlay-motion';
import { CodeBlock } from './CodeBlock';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-denied';

export type ToolType = `tool-${string}` | 'dynamic-tool';

const statusLabels: Record<ToolState, string> = {
  'approval-requested': 'Awaiting Approval',
  'approval-responded': 'Responded',
  'input-available': 'Running',
  'input-streaming': 'Pending',
  'output-available': 'Completed',
  'output-denied': 'Denied',
  'output-error': 'Error',
};

const statusIconClass: Record<ToolState, string> = {
  'approval-requested': 'text-warning',
  'approval-responded': 'text-accent',
  'input-available': 'animate-pulse text-content-muted',
  'input-streaming': 'text-content-muted',
  'output-available': 'text-success',
  'output-denied': 'text-warning',
  'output-error': 'text-danger',
};

function StatusIcon(props: { state: ToolState }) {
  const className = () => cn('size-16 shrink-0', statusIconClass[props.state]);
  switch (props.state) {
    case 'approval-requested':
      return <Clock size={16} strokeWidth={1.7} class={className()} aria-hidden="true" />;
    case 'approval-responded':
      return <CheckCircle size={16} strokeWidth={1.7} class={className()} aria-hidden="true" />;
    case 'input-available':
      return <Clock size={16} strokeWidth={1.7} class={className()} aria-hidden="true" />;
    case 'input-streaming':
      return <Circle size={16} strokeWidth={1.7} class={className()} aria-hidden="true" />;
    case 'output-available':
      return <CheckCircle size={16} strokeWidth={1.7} class={className()} aria-hidden="true" />;
    case 'output-denied':
      return <XCircle size={16} strokeWidth={1.7} class={className()} aria-hidden="true" />;
    case 'output-error':
      return <XCircle size={16} strokeWidth={1.7} class={className()} aria-hidden="true" />;
  }
}

export function getStatusBadge(state: ToolState) {
  return (
    <span
      data-slot="tool-status-badge"
      class="inline-flex items-center gap-6 rounded-full border border-border-strong bg-surface px-8 py-2 text-11 font-medium text-content-secondary"
    >
      <StatusIcon state={state} />
      {statusLabels[state]}
    </span>
  );
}

type ToolRootProps = ComponentProps<typeof Collapsible> & {
  state: ToolState;
};

export const Tool: Component<ToolRootProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'state', 'children']);
  return (
    <Collapsible
      data-slot="tool"
      data-state={local.state}
      class={cn(
        'group mb-8 w-full rounded-8 border border-border-subtle bg-surface shadow-none not-prose',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </Collapsible>
  );
};

type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  title?: string;
  state: ToolState;
  type?: ToolType;
  toolName?: string;
};

function deriveToolTitle(type?: ToolType, toolName?: string, title?: string) {
  if (title) return title;
  if (type === 'dynamic-tool') return toolName ?? 'Tool';
  if (type?.startsWith('tool-')) return type.split('-').slice(1).join('-');
  return 'Tool';
}

export const ToolHeader: Component<ToolHeaderProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'title', 'state', 'type', 'toolName', 'children']);
  const resolvedTitle = () => deriveToolTitle(local.type, local.toolName, local.title);

  return (
    <CollapsibleTrigger
      data-slot="tool-header"
      class={cn(
        'ui-tool-trigger flex w-full cursor-pointer items-center justify-between gap-12 border-0 bg-transparent px-12 py-10 text-left transition-colors duration-120 outline-none hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? (
        <>
          <span class="flex min-w-0 items-center gap-8">
            <Wrench size={14} strokeWidth={1.7} class="shrink-0 text-content-muted" aria-hidden="true" />
            <span class="truncate text-13 font-medium text-content-primary">{resolvedTitle()}</span>
            {getStatusBadge(local.state)}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.7}
            class="ui-tool-chevron shrink-0 text-content-muted"
            aria-hidden="true"
          />
        </>
      )}
    </CollapsibleTrigger>
  );
};

export const ToolContent: Component<ComponentProps<typeof CollapsibleContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CollapsibleContent
      data-slot="tool-content"
      class={cn(
        'border-t border-border-subtle px-12 py-10 text-12 text-content-secondary outline-none',
        disclosureContentMotion,
        local.class,
      )}
      {...rest}
    >
      <div class="flex flex-col gap-12">{local.children}</div>
    </CollapsibleContent>
  );
};

type ToolInputProps = ComponentProps<'div'> & {
  input: unknown;
};

export const ToolInput: Component<ToolInputProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'input', 'children']);
  const code = () => {
    if (local.input === undefined) return '';
    if (typeof local.input === 'string') return local.input;
    try {
      return JSON.stringify(local.input, null, 2);
    } catch {
      return String(local.input);
    }
  };

  return (
    <div data-slot="tool-input" class={cn('flex flex-col gap-8 overflow-hidden', local.class)} {...rest}>
      <div class="text-11 font-medium tracking-wide text-content-muted uppercase">Parameters</div>
      <Show
        when={local.children}
        fallback={(
          <div class="rounded-6 bg-surface-muted">
            <CodeBlock code={code()} language="json" />
          </div>
        )}
      >
        {local.children}
      </Show>
    </div>
  );
};

type ToolOutputProps = ComponentProps<'div'> & {
  output?: unknown;
  errorText?: string;
  children?: JSX.Element;
};

function isJsxElement(value: unknown): value is JSX.Element {
  return typeof value === 'object' && value !== null && 't' in (value as Record<string, unknown>);
}

export const ToolOutput: Component<ToolOutputProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'output', 'errorText', 'children']);
  const hasContent = () =>
    Boolean(local.errorText || local.output !== undefined || local.children);

  const renderOutput = () => {
    if (local.errorText) return null;
    if (local.output === undefined) return null;
    if (isJsxElement(local.output)) return local.output;
    if (typeof local.output === 'string') {
      return <CodeBlock code={local.output} language="json" />;
    }
    if (typeof local.output === 'object') {
      return <CodeBlock code={JSON.stringify(local.output, null, 2)} language="json" />;
    }
    return <div>{String(local.output)}</div>;
  };

  return (
    <Show when={hasContent()}>
      <div data-slot="tool-output" class={cn('flex flex-col gap-8', local.class)} {...rest}>
        <div class="text-11 font-medium tracking-wide text-content-muted uppercase">
          {local.errorText ? 'Error' : 'Result'}
        </div>
        <Show when={local.children} fallback={(
          <div
            class={cn(
              'overflow-x-auto rounded-6 text-12 [&_table]:w-full',
              local.errorText ? 'bg-danger-soft text-danger' : 'bg-surface-muted text-content-secondary',
            )}
          >
            <Show when={local.errorText}>
              <div class="p-10">{local.errorText}</div>
            </Show>
            <Show when={!local.errorText}>{renderOutput()}</Show>
          </div>
        )}>
          {local.children}
        </Show>
      </div>
    </Show>
  );
};
