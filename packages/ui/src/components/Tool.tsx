import { ChevronDown, Wrench } from 'lucide-solid';
import { Show, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Badge } from './Badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';
import { InlineCode } from './Typography';

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-denied';

type ToolRootProps = ComponentProps<typeof Collapsible> & {
  state: ToolState;
};

const statusLabels: Record<ToolState, string> = {
  'approval-requested': 'Awaiting Approval',
  'approval-responded': 'Responded',
  'input-available': 'Running',
  'input-streaming': 'Pending',
  'output-available': 'Completed',
  'output-denied': 'Denied',
  'output-error': 'Error',
};

const statusTone: Record<ToolState, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  'approval-requested': 'warning',
  'approval-responded': 'info',
  'input-available': 'info',
  'input-streaming': 'neutral',
  'output-available': 'success',
  'output-denied': 'warning',
  'output-error': 'danger',
};

export function getStatusBadge(state: ToolState) {
  return <Badge tone={statusTone[state]}>{statusLabels[state]}</Badge>;
}

export const Tool: Component<ToolRootProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'state', 'children']);
  return (
    <Collapsible
      data-slot="tool"
      data-state={local.state}
      class={cn('mb-8 w-full rounded-8 border border-border-subtle bg-surface shadow-none', local.class)}
      {...rest}
    >
      {local.children}
    </Collapsible>
  );
};

type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  state: ToolState;
};

export const ToolHeader: Component<ToolHeaderProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'title', 'state', 'children']);
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
            <span class="truncate text-13 font-medium text-content-primary">{local.title}</span>
          </span>
          <span class="flex shrink-0 items-center gap-8">
            {getStatusBadge(local.state)}
            <ChevronDown
              size={14}
              strokeWidth={1.7}
              class="ui-tool-chevron text-content-muted"
              aria-hidden="true"
            />
          </span>
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
      class={cn('border-t border-border-subtle px-12 py-10 text-12 text-content-secondary', local.class)}
      {...rest}
    >
      <div class="flex flex-col gap-12">{local.children}</div>
    </CollapsibleContent>
  );
};

type ToolInputProps = ComponentProps<'div'> & {
  input: unknown;
};

function formatToolPayload(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const ToolInput: Component<ToolInputProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'input', 'children']);
  const formatted = () => formatToolPayload(local.input);
  return (
    <div data-slot="tool-input" class={cn('flex flex-col gap-8', local.class)} {...rest}>
      <div class="text-11 font-medium tracking-wide text-content-muted uppercase">Parameters</div>
      <Show when={local.children} fallback={(
        <pre class="m-0 overflow-x-auto rounded-6 border border-border-subtle bg-surface-muted p-10">
          <InlineCode class="block whitespace-pre-wrap break-words text-11 leading-normal text-content-secondary">
            {formatted()}
          </InlineCode>
        </pre>
      )}>
        {local.children}
      </Show>
    </div>
  );
};

type ToolOutputProps = ComponentProps<'div'> & {
  output?: unknown;
  errorText?: string;
};

export const ToolOutput: Component<ToolOutputProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'output', 'errorText', 'children']);
  const hasContent = () => Boolean(local.errorText || local.output !== undefined || local.children);
  const formattedOutput = () => formatToolPayload(local.output);

  return (
    <Show when={hasContent()}>
      <div data-slot="tool-output" class={cn('flex flex-col gap-8', local.class)} {...rest}>
        <div class="text-11 font-medium tracking-wide text-content-muted uppercase">
          {local.errorText ? 'Error' : 'Result'}
        </div>
        <Show when={local.children} fallback={(
          <>
            <Show when={local.errorText}>
              <p class="m-0 text-12 text-danger">{local.errorText}</p>
            </Show>
            <Show when={!local.errorText && local.output !== undefined}>
              <pre class="m-0 overflow-x-auto rounded-6 border border-border-subtle bg-surface-muted p-10">
                <InlineCode class="block whitespace-pre-wrap break-words text-11 leading-normal text-content-secondary">
                  {formattedOutput()}
                </InlineCode>
              </pre>
            </Show>
          </>
        )}>
          {local.children}
        </Show>
      </div>
    </Show>
  );
};
