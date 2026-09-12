import {
  createContext,
  createMemo,
  Show,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Alert, AlertDescription } from './Alert';
import { Button } from './Button';
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

interface ConfirmationContextValue {
  approval: () => ConfirmationApproval;
  state: () => ToolState;
}

const ConfirmationContext = createContext<ConfirmationContextValue>();

function useConfirmation(component: string) {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error(`${component} must be used within Confirmation`);
  }
  return context;
}

type ConfirmationRootProps = ComponentProps<'div'> & {
  approval?: ConfirmationApproval;
  state: ToolState;
};

/** 工具审批容器：input 阶段隐藏，后续按 state 展示子块。 */
export const Confirmation: Component<ConfirmationRootProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'approval', 'state']);
  const shouldRender = () =>
    Boolean(local.approval)
    && local.state !== 'input-streaming'
    && local.state !== 'input-available';

  const context: ConfirmationContextValue = {
    approval: () => local.approval,
    state: () => local.state,
  };

  return (
    <Show when={shouldRender()}>
      <ConfirmationContext.Provider value={context}>
        <Alert
          data-slot="confirmation"
          data-state={local.state}
          data-approval-id={local.approval?.id}
          class={cn('flex w-full flex-col gap-8', local.class)}
          {...rest}
        >
          {local.children}
        </Alert>
      </ConfirmationContext.Provider>
    </Show>
  );
};

export const ConfirmationTitle: Component<ComponentProps<typeof AlertDescription>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <AlertDescription
      data-slot="confirmation-title"
      class={cn('inline text-13', local.class)}
      {...rest}
    />
  );
};

type ConfirmationSlotProps = {
  children?: JSX.Element;
};

/** 仅在 approval-requested 时渲染。 */
export const ConfirmationRequest: Component<ConfirmationSlotProps> = (props) => {
  const { state } = useConfirmation('ConfirmationRequest');
  return <Show when={state() === 'approval-requested'}>{props.children}</Show>;
};

/** 审批通过后在 responded / denied / available 阶段渲染。 */
export const ConfirmationAccepted: Component<ConfirmationSlotProps> = (props) => {
  const { approval, state } = useConfirmation('ConfirmationAccepted');
  const visible = createMemo(() => {
    const current = state();
    return (
      Boolean(approval()?.approved)
      && (current === 'approval-responded'
        || current === 'output-denied'
        || current === 'output-available')
    );
  });
  return <Show when={visible()}>{props.children}</Show>;
};

/** 审批拒绝后在 responded / denied / available 阶段渲染。 */
export const ConfirmationRejected: Component<ConfirmationSlotProps> = (props) => {
  const { approval, state } = useConfirmation('ConfirmationRejected');
  const visible = createMemo(() => {
    const current = state();
    return (
      approval()?.approved === false
      && (current === 'approval-responded'
        || current === 'output-denied'
        || current === 'output-available')
    );
  });
  return <Show when={visible()}>{props.children}</Show>;
};

export const ConfirmationActions: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { state } = useConfirmation('ConfirmationActions');

  return (
    <Show when={state() === 'approval-requested'}>
      <div
        data-slot="confirmation-actions"
        class={cn('flex items-center justify-end gap-8 self-end', local.class)}
        {...rest}
      >
        {local.children}
      </div>
    </Show>
  );
};

export const ConfirmationAction: Component<ComponentProps<typeof Button>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'size']);
  return (
    <Button
      type="button"
      size={local.size ?? 'sm'}
      class={cn('h-32 px-12 text-13', local.class)}
      {...rest}
    />
  );
};
