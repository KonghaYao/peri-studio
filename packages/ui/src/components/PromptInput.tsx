import {
  createContext,
  createMemo,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { CornerDownLeft } from 'lucide-solid';
import { cn } from '../lib/cn';
import { createControllableSignal } from '../lib/controllable-state';
import { Button } from './Button';
import { Textarea } from './Textarea';

export type PromptInputSubmitData = {
  text: string;
};

interface PromptInputContextValue {
  text: () => string;
  setText: (value: string) => void;
  isEmpty: () => boolean;
  submit: () => void;
}

const PromptInputContext = createContext<PromptInputContextValue>();

function usePromptInputContext(component: string): PromptInputContextValue {
  const context = useContext(PromptInputContext);
  if (!context) {
    throw new Error(`${component} must be used within PromptInput`);
  }
  return context;
}

export function usePromptInput() {
  return usePromptInputContext('usePromptInput');
}

type PromptInputProps = Omit<ComponentProps<'form'>, 'onSubmit'> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (data: PromptInputSubmitData) => void;
  /** 提交成功后清空输入；默认 true。 */
  clearOnSubmit?: boolean;
};

/** Composer 根容器：管理文本状态并在表单提交时回调 onSubmit。 */
export const PromptInput: Component<PromptInputProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'value',
    'defaultValue',
    'onValueChange',
    'onSubmit',
    'clearOnSubmit',
  ]);

  const clearOnSubmit = () => local.clearOnSubmit ?? true;

  const [text, setText] = createControllableSignal<string>({
    prop: () => local.value,
    defaultProp: local.defaultValue ?? '',
    onChange: local.onValueChange,
  });

  const isEmpty = createMemo(() => text().trim().length === 0);

  const submit = () => {
    const trimmed = text().trim();
    if (!trimmed) return;
    local.onSubmit?.({ text: trimmed });
    if (clearOnSubmit()) {
      setText('');
    }
  };

  const handleSubmit: JSX.EventHandlerUnion<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault();
    submit();
  };

  const contextValue: PromptInputContextValue = {
    text,
    setText,
    isEmpty,
    submit,
  };

  return (
    <PromptInputContext.Provider value={contextValue}>
      <form
        data-slot="prompt-input"
        class={cn(
          'flex w-full flex-col rounded-8 border border-border-strong bg-surface shadow-(--shadow-composer-overlay) ui-control-transition',
          'focus-within:border-focus-ring',
          local.class,
        )}
        onSubmit={handleSubmit}
        {...rest}
      >
        {local.children}
      </form>
    </PromptInputContext.Provider>
  );
};

type PromptInputTextareaProps = Omit<ComponentProps<typeof Textarea>, 'variant' | 'value'> & {
  value?: string;
};

/** 自动增高输入区：Enter 提交，Shift+Enter 换行。 */
export const PromptInputTextarea: Component<PromptInputTextareaProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'onKeyDown', 'onInput', 'value']);
  const context = usePromptInputContext('PromptInputTextarea');

  const handleKeyDown: JSX.EventHandlerUnion<HTMLTextAreaElement, KeyboardEvent> = (event) => {
    const keyDown = local.onKeyDown;
    if (typeof keyDown === 'function') keyDown(event);
    if (event.defaultPrevented) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const form = event.currentTarget.form;
      const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null;
      if (submitButton?.disabled) return;
      form?.requestSubmit();
    }
  };

  const handleInput: JSX.EventHandlerUnion<HTMLTextAreaElement, InputEvent> = (event) => {
    context.setText(event.currentTarget.value);
    const input = local.onInput;
    if (typeof input === 'function') {
      (input as (event: InputEvent) => void)(event);
    }
  };

  return (
    <Textarea
      data-slot="prompt-input-textarea"
      variant="bare"
      autoResize
      class={cn('min-h-36 px-12 py-8 text-13 leading-normal', local.class)}
      value={local.value ?? context.text()}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      {...rest}
    />
  );
};

/** 工具栏槽位：放置附件、模型选择等左侧操作。 */
export const PromptInputToolbar: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="prompt-input-toolbar"
      class={cn('flex min-h-36 min-w-0 shrink items-center gap-4', local.class)}
      {...rest}
    />
  );
};

type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  label?: string;
};

/** 提交按钮：文本为空时自动禁用。 */
export const PromptInputSubmit: Component<PromptInputSubmitProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'disabled', 'label', 'type']);
  const context = usePromptInputContext('PromptInputSubmit');

  return (
    <Button
      type={local.type ?? 'submit'}
      data-slot="prompt-input-submit"
      variant="primary"
      size="sm"
      class={cn('shrink-0', local.class)}
      disabled={local.disabled || context.isEmpty()}
      aria-label={local.label ?? 'Send message'}
      {...rest}
    >
      {local.children ?? <CornerDownLeft size={16} strokeWidth={1.7} aria-hidden="true" />}
    </Button>
  );
};

/** 底部栏：工具栏与提交按钮的水平布局。 */
export const PromptInputFooter: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="prompt-input-footer"
      class={cn('flex min-h-36 items-center gap-8 px-8 pb-8', local.class)}
      {...rest}
    />
  );
};
