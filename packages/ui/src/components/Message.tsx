import { ChevronLeft, ChevronRight } from 'lucide-solid';
import {
  children,
  createContext,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  Show,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Button, IconButton } from './Button';
import { ButtonGroup, buttonGroupItemClass } from './ButtonGroup';

export type MessageAlign = 'start' | 'end';
export type MessageRole = 'user' | 'assistant' | 'system';

type MessageContextValue = {
  align: Accessor<MessageAlign>;
};

const MessageContext = createContext<MessageContextValue>();

function useMessageContext(component: string): MessageContextValue {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error(`${component} must be used within Message`);
  }
  return context;
}

function resolveMessageAlign(from: MessageRole | undefined, align: MessageAlign | undefined): MessageAlign {
  if (from === 'user') return 'end';
  if (from === 'assistant' || from === 'system') return 'start';
  return align ?? 'start';
}

type MessageProps = ComponentProps<'div'> & {
  align?: MessageAlign;
  /** AI Elements 兼容：user → end，assistant/system → start。 */
  from?: MessageRole;
};

/** 会话消息行：头像、对齐、头尾元数据与气泡内容。 */
export const Message: Component<MessageProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'align', 'from']);
  const align = createMemo(() => resolveMessageAlign(local.from, local.align));

  return (
    <MessageContext.Provider value={{ align }}>
      <div
        data-slot="message"
        data-align={align()}
        data-from={local.from}
        class={cn(
          'group/message flex w-full min-w-0 gap-8',
          local.from === 'user' ? 'is-user ml-auto justify-end' : local.from ? 'is-assistant' : undefined,
          align() === 'end' ? 'flex-row-reverse' : 'flex-row',
          local.class,
        )}
        {...rest}
      />
    </MessageContext.Provider>
  );
};

/** 同一发送者的连续消息分组。 */
export const MessageGroup: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="message-group"
      class={cn('flex min-w-0 flex-col gap-8', local.class)}
      {...rest}
    />
  );
};

/** 消息头像槽位，锚定在气泡底部。 */
export const MessageAvatar: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  useMessageContext('MessageAvatar');
  return (
    <div
      data-slot="message-avatar"
      class={cn('flex shrink-0 self-end', local.class)}
      {...rest}
    />
  );
};

/** 包裹 header、气泡表面与 footer。 */
export const MessageContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { align } = useMessageContext('MessageContent');
  return (
    <div
      data-slot="message-content"
      class={cn(
        'flex min-w-0 flex-1 flex-col gap-4 text-13',
        align() === 'end' ? 'items-end' : 'items-start',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 消息上方元数据（如发送者名称），始终左对齐。 */
export const MessageHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  useMessageContext('MessageHeader');
  return (
    <div
      data-slot="message-header"
      class={cn('self-start text-11 text-content-muted', local.class)}
      {...rest}
    />
  );
};

/** 消息下方元数据或操作，跟随消息侧对齐。 */
export const MessageFooter: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { align } = useMessageContext('MessageFooter');
  return (
    <div
      data-slot="message-footer"
      class={cn(
        'flex items-center gap-8 text-11 text-content-muted',
        align() === 'end' ? 'self-end' : 'self-start',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 消息行内操作按钮组容器。 */
export const MessageActions: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div data-slot="message-actions" class={cn('flex items-center gap-4', local.class)} {...rest}>
      {local.children}
    </div>
  );
};

type MessageActionProps = ComponentProps<'button'> & {
  tooltip?: string;
  label?: string;
};

/** 单条消息操作按钮，可选 tooltip。 */
export const MessageAction: Component<MessageActionProps> = (props) => {
  const [local, rest] = splitProps(props, ['tooltip', 'label', 'children', 'class']);
  const a11yLabel = () => local.label ?? local.tooltip ?? 'Message action';

  return (
    <IconButton
      type="button"
      variant="ghost"
      size="sm"
      label={a11yLabel()}
      showTooltip={!!local.tooltip}
      title={local.tooltip}
      data-slot="message-action"
      class={local.class}
      {...rest}
    >
      {local.children}
    </IconButton>
  );
};

interface MessageBranchContextValue {
  currentBranch: Accessor<number>;
  totalBranches: Accessor<number>;
  goToPrevious: () => void;
  goToNext: () => void;
  setBranchCount: (count: number) => void;
}

const MessageBranchContext = createContext<MessageBranchContextValue>();

function useMessageBranch(component: string): MessageBranchContextValue {
  const context = useContext(MessageBranchContext);
  if (!context) {
    throw new Error(`${component} must be used within MessageBranch`);
  }
  return context;
}

type MessageBranchProps = ComponentProps<'div'> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

/** 消息分支切换容器（多版本回复）。 */
export const MessageBranch: Component<MessageBranchProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'defaultBranch', 'onBranchChange']);
  const [currentBranch, setCurrentBranch] = createSignal(local.defaultBranch ?? 0);
  const [branchCount, setBranchCount] = createSignal(0);

  const handleBranchChange = (nextBranch: number) => {
    setCurrentBranch(nextBranch);
    local.onBranchChange?.(nextBranch);
  };

  const goToPrevious = () => {
    const total = branchCount();
    const next = currentBranch() > 0 ? currentBranch() - 1 : Math.max(total - 1, 0);
    handleBranchChange(next);
  };

  const goToNext = () => {
    const total = branchCount();
    const next = total > 0 && currentBranch() < total - 1 ? currentBranch() + 1 : 0;
    handleBranchChange(next);
  };

  const context: MessageBranchContextValue = {
    currentBranch,
    totalBranches: branchCount,
    goToPrevious,
    goToNext,
    setBranchCount,
  };

  return (
    <MessageBranchContext.Provider value={context}>
      <div
        data-slot="message-branch"
        class={cn('grid w-full gap-8', local.class)}
        {...rest}
      />
    </MessageBranchContext.Provider>
  );
};

/** 注册并渲染各分支内容，仅展示当前分支。 */
export const MessageBranchContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { currentBranch, setBranchCount } = useMessageBranch('MessageBranchContent');
  const resolved = children(() => local.children);
  const branchItems = createMemo(() => resolved.toArray());

  createRenderEffect(() => {
    setBranchCount(branchItems().length);
  });

  return (
    <For each={branchItems()}>
      {(branch, index) => (
        <Show when={index() === currentBranch()}>
          <div
            data-slot="message-branch-content"
            data-branch-index={index()}
            class={cn('grid gap-8 overflow-hidden', local.class)}
            {...rest}
          >
            {branch}
          </div>
        </Show>
      )}
    </For>
  );
};

/** 分支切换控件容器；仅多分支时渲染。 */
export const MessageBranchSelector: Component<ComponentProps<typeof ButtonGroup>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'aria-label']);
  const { totalBranches } = useMessageBranch('MessageBranchSelector');

  if (totalBranches() <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      data-slot="message-branch-selector"
      aria-label={local['aria-label'] ?? 'Message branches'}
      class={local.class}
      {...rest}
    >
      {local.children}
    </ButtonGroup>
  );
};

type MessageBranchNavProps = ComponentProps<'button'>;

/** 切换到上一分支。 */
export const MessageBranchPrevious: Component<MessageBranchNavProps> = (props) => {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const { goToPrevious, totalBranches } = useMessageBranch('MessageBranchPrevious');

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label="Previous branch"
      disabled={totalBranches() <= 1}
      data-slot="message-branch-previous"
      class={cn(buttonGroupItemClass, local.class)}
      onClick={goToPrevious}
      {...rest}
    >
      {local.children ?? <ChevronLeft size={14} strokeWidth={1.7} aria-hidden="true" />}
    </Button>
  );
};

/** 切换到下一分支。 */
export const MessageBranchNext: Component<MessageBranchNavProps> = (props) => {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const { goToNext, totalBranches } = useMessageBranch('MessageBranchNext');

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label="Next branch"
      disabled={totalBranches() <= 1}
      data-slot="message-branch-next"
      class={cn(buttonGroupItemClass, local.class)}
      onClick={goToNext}
      {...rest}
    >
      {local.children ?? <ChevronRight size={14} strokeWidth={1.7} aria-hidden="true" />}
    </Button>
  );
};

/** 当前分支页码指示。 */
export const MessageBranchPage: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { currentBranch, totalBranches } = useMessageBranch('MessageBranchPage');

  return (
    <span
      data-slot="message-branch-page"
      class={cn(
        'inline-flex h-28 min-w-28 items-center justify-center px-8 text-12 text-content-muted',
        local.class,
      )}
      {...rest}
    >
      {currentBranch() + 1} of {totalBranches()}
    </span>
  );
};

/** 消息底部工具栏（操作与分支切换等）。 */
export const MessageToolbar: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="message-toolbar"
      class={cn('mt-16 flex w-full items-center justify-between gap-16', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};
