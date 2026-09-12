import { Show, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Alert, AlertTitle } from './Alert';
import type { ToolState } from './Tool';

export type ConfirmationApproval =
  | {
      id: string;
      approved?: never;
      reason?: never;
    }
  | {
      id: string;
      approved: boolean;
      reason?: string;
    }
  | undefined;

type ConfirmationRootProps = ComponentProps<'div'> & {
  approval?: ConfirmationApproval;
  state: ToolState;
};

export const Confirmation: Component<ConfirmationRootProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'approval', 'state']);
  const shouldRender = () =>
    Boolean(local.approval)
    && local.state !== 'input-streaming'
    && local.state !== 'input-available';

  return (
    <Show when={shouldRender()}>
      <Alert
        data-slot="confirmation"
        data-state={local.state}
        data-approval-id={local.approval?.id}
        variant={local.state === 'output-error' || local.state === 'output-denied' ? 'destructive' : 'default'}
        class={cn('mb-8 w-full', local.class)}
        {...rest}
      >
        {local.children}
      </Alert>
    </Show>
  );
};

export const ConfirmationTitle: Component<ComponentProps<typeof AlertTitle>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <AlertTitle
      data-slot="confirmation-title"
      class={cn('text-13', local.class)}
      {...rest}
    />
  );
};

type ConfirmationActionsProps = ComponentProps<'div'> & {
  state: ToolState;
};

export const ConfirmationActions: Component<ConfirmationActionsProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'state']);

  return (
    <Show when={local.state === 'approval-requested'}>
      <div
        data-slot="confirmation-actions"
        class={cn('mt-8 flex flex-wrap items-center gap-8', local.class)}
        {...rest}
      >
        {local.children}
      </div>
    </Show>
  );
};
