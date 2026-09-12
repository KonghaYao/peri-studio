import { CornerDownLeft, Plus, Square, X } from 'lucide-solid';
import {
  children,
  createSignal,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../../lib/cn';
import { Button } from '../Button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../Command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../HoverCard';
import { InputGroupButton } from '../InputGroup';
import { Spinner } from '../Spinner';
import { Textarea } from '../Textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';
import {
  useOptionalPromptInputController,
  usePromptInputAttachments,
} from './context';
import { usePromptInputContext } from './form-context';
import type { ChatStatus } from './types';

export const PromptInputBody: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <div data-slot="prompt-input-body" class={cn('contents', local.class)} {...rest} />;
};

type PromptInputTextareaProps = Omit<ComponentProps<typeof Textarea>, 'variant' | 'value'> & {
  value?: string;
  placeholder?: string;
};

/** 自动增高输入区：Enter 提交，Shift+Enter 换行；支持粘贴与 Backspace 移除附件。 */
export const PromptInputTextarea: Component<PromptInputTextareaProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'onKeyDown',
    'onInput',
    'onPaste',
    'onCompositionStart',
    'onCompositionEnd',
    'value',
    'placeholder',
  ]);
  const context = usePromptInputContext('PromptInputTextarea');
  const controller = useOptionalPromptInputController();
  const attachments = usePromptInputAttachments();
  const [isComposing, setIsComposing] = createSignal(false);

  const handleKeyDown: JSX.EventHandlerUnion<HTMLTextAreaElement, KeyboardEvent> = (event) => {
    const keyDown = local.onKeyDown;
    if (typeof keyDown === 'function') keyDown(event);
    if (event.defaultPrevented) return;

    if (event.key === 'Enter') {
      if (isComposing() || event.isComposing) return;
      if (event.shiftKey) return;
      event.preventDefault();
      if (context.isEmpty() && attachments.files().length === 0) return;
      context.submit();
    }

    if (event.key === 'Backspace' && event.currentTarget.value === '' && attachments.files().length > 0) {
      event.preventDefault();
      const last = attachments.files().at(-1);
      if (last) attachments.remove(last.id);
    }
  };

  const handlePaste: JSX.EventHandlerUnion<HTMLTextAreaElement, ClipboardEvent> = (event) => {
    const paste = local.onPaste;
    if (typeof paste === 'function') paste(event);
    if (event.defaultPrevented) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    const pasted: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) pasted.push(file);
      }
    }
    if (pasted.length > 0) {
      event.preventDefault();
      attachments.add(pasted);
    }
  };

  const handleInput: JSX.EventHandlerUnion<HTMLTextAreaElement, InputEvent> = (event) => {
    const value = event.currentTarget.value;
    if (controller) controller.textInput.setInput(value);
    else context.setText(value);
    const input = local.onInput;
    if (typeof input === 'function') {
      input(event as InputEvent & { currentTarget: HTMLTextAreaElement; target: HTMLTextAreaElement });
    }
  };

  const value = () => local.value ?? (controller ? controller.textInput.value() : context.text());

  return (
    <Textarea
      data-slot="prompt-input-textarea"
      variant="bare"
      autoResize
      name="message"
      class={cn('min-h-36 max-h-48 px-12 py-8 text-13 leading-normal', local.class)}
      placeholder={local.placeholder ?? 'What would you like to know?'}
      value={value()}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onCompositionStart={(event) => {
        setIsComposing(true);
        const handler = local.onCompositionStart;
        if (typeof handler === 'function') handler(event);
      }}
      onCompositionEnd={(event) => {
        setIsComposing(false);
        const handler = local.onCompositionEnd;
        if (typeof handler === 'function') handler(event);
      }}
      {...rest}
    />
  );
};

export const PromptInputHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="prompt-input-header"
      class={cn('order-first flex flex-wrap gap-4 px-8 pt-8', local.class)}
      {...rest}
    />
  );
};

export const PromptInputFooter: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="prompt-input-footer"
      class={cn('flex min-h-36 items-center justify-between gap-8 px-8 pb-8', local.class)}
      {...rest}
    />
  );
};

export const PromptInputTools: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="prompt-input-tools"
      class={cn('flex min-w-0 items-center gap-4', local.class)}
      {...rest}
    />
  );
};

/** @deprecated 使用 PromptInputTools */
export const PromptInputToolbar = PromptInputTools;

type PromptInputButtonTooltip =
  | string
  | {
      content: JSX.Element;
      shortcut?: string;
      side?: 'top' | 'bottom' | 'left' | 'right';
    };

type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip;
};

export const PromptInputButton: Component<PromptInputButtonProps> = (props) => {
  const [local, rest] = splitProps(props, ['tooltip', 'children', 'class', 'size']);
  const resolved = children(() => local.children);
  const childCount = () => resolved.toArray().length;
  const size = () => local.size ?? (childCount() > 1 ? 'sm' : 'sm');

  const button = (
    <InputGroupButton type="button" size={size()} class={local.class} {...rest}>
      {local.children}
    </InputGroupButton>
  );

  return (
    <Show when={local.tooltip} fallback={button}>
      <Tooltip>
        <TooltipTrigger as="div" class="inline-flex">
          {button}
        </TooltipTrigger>
        <TooltipContent>
          {typeof local.tooltip === 'string' ? local.tooltip : local.tooltip?.content}
          {typeof local.tooltip !== 'string' && local.tooltip?.shortcut && (
            <span class="ml-8 text-content-muted">{local.tooltip.shortcut}</span>
          )}
        </TooltipContent>
      </Tooltip>
    </Show>
  );
};

export const PromptInputActionMenu = DropdownMenu;

export const PromptInputActionMenuTrigger: Component<PromptInputButtonProps> = (props) => {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <DropdownMenuTrigger as="div" class="inline-flex">
      <PromptInputButton class={local.class} {...rest}>
        {local.children ?? <Plus size={16} strokeWidth={1.7} aria-hidden="true" />}
      </PromptInputButton>
    </DropdownMenuTrigger>
  );
};

export const PromptInputActionMenuContent: Component<ComponentProps<typeof DropdownMenuContent>> = (
  props,
) => {
  const [local, rest] = splitProps(props, ['class']);
  return <DropdownMenuContent class={cn(local.class)} {...rest} />;
};

export const PromptInputActionMenuItem = DropdownMenuItem;

type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
  onStop?: () => void;
  label?: string;
};

/** 提交按钮：支持 ChatStatus 流式/停止态；文本为空且无附件时禁用。 */
export const PromptInputSubmit: Component<PromptInputSubmitProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'disabled',
    'label',
    'type',
    'status',
    'onStop',
    'onClick',
  ]);
  const context = usePromptInputContext('PromptInputSubmit');
  const attachments = usePromptInputAttachments();
  const isGenerating = () => local.status === 'submitted' || local.status === 'streaming';

  const icon = () => {
    if (local.status === 'submitted') return <Spinner class="size-16" decorative />;
    if (local.status === 'streaming') return <Square size={16} strokeWidth={1.7} aria-hidden="true" />;
    if (local.status === 'error') return <X size={16} strokeWidth={1.7} aria-hidden="true" />;
    return <CornerDownLeft size={16} strokeWidth={1.7} aria-hidden="true" />;
  };

  const handleClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (event) => {
    if (isGenerating() && local.onStop) {
      event.preventDefault();
      local.onStop();
      return;
    }
    const click = local.onClick;
    if (typeof click === 'function') click(event);
  };

  const disabled = () =>
    local.disabled || (context.isEmpty() && attachments.files().length === 0 && !isGenerating());

  return (
    <Button
      type={isGenerating() && local.onStop ? 'button' : (local.type ?? 'submit')}
      data-slot="prompt-input-submit"
      variant="primary"
      size="sm"
      class={cn('shrink-0', local.class)}
      disabled={disabled()}
      aria-label={isGenerating() ? 'Stop' : (local.label ?? 'Submit')}
      onClick={handleClick}
      {...rest}
    >
      {local.children ?? icon()}
    </Button>
  );
};

export const PromptInputHoverCard = HoverCard;
export const PromptInputHoverCardTrigger = HoverCardTrigger;
export const PromptInputHoverCardContent = HoverCardContent;
export const PromptInputCommand = Command;
export const PromptInputCommandInput = CommandInput;
export const PromptInputCommandList = CommandList;
export const PromptInputCommandEmpty = CommandEmpty;
export const PromptInputCommandGroup = CommandGroup;
export const PromptInputCommandItem = CommandItem;
export const PromptInputCommandSeparator = CommandSeparator;
export const PromptInputTabsList: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <div data-slot="prompt-input-tabs-list" class={cn(local.class)} {...rest} />;
};
export const PromptInputTab: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <div data-slot="prompt-input-tab" class={cn(local.class)} {...rest} />;
};
export const PromptInputTabLabel: Component<ComponentProps<'h3'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <h3
      data-slot="prompt-input-tab-label"
      class={cn('mb-8 px-12 text-11 font-medium text-content-muted', local.class)}
      {...rest}
    />
  );
};
export const PromptInputTabBody: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <div data-slot="prompt-input-tab-body" class={cn('flex flex-col gap-4', local.class)} {...rest} />;
};
export const PromptInputTabItem: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="prompt-input-tab-item"
      class={cn('flex items-center gap-8 px-12 py-8 text-12 hover:bg-interaction-hover', local.class)}
      {...rest}
    />
  );
};
