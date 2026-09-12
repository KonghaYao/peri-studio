import {
  createContext,
  createMemo,
  createSignal,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';

type InputOTPContextValue = {
  value: () => string;
  maxLength: () => number;
  disabled: () => boolean;
  setChar: (index: number, char: string) => void;
  removeChar: (index: number) => void;
  focusSlot: (index: number) => void;
  registerSlot: (index: number, element: HTMLInputElement) => void;
  isActive: (index: number) => boolean;
  setActiveIndex: (index: number) => void;
};

const InputOTPContext = createContext<InputOTPContextValue>();

function useInputOTPContext(component: string) {
  const context = useContext(InputOTPContext);
  if (!context) {
    throw new Error(`${component} must be used within InputOTP`);
  }
  return context;
}

const slotInputClasses = (active: boolean, disabled: boolean) => cn(
  'box-border h-32 w-32 rounded-6 border bg-surface text-center text-13 text-text-primary outline-none ui-control-transition',
  'placeholder:text-text-faint',
  disabled
    ? 'cursor-not-allowed border-border-strong bg-surface-muted text-text-muted'
    : active
      ? 'border-focus-ring'
      : 'border-border-strong hover:border-accent-border-hover focus:border-focus-ring',
);

type InputOTPProps = Omit<ComponentProps<'div'>, 'onChange'> & {
  maxLength: number;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
};

/** OTP 根容器：管理多位单字符输入、焦点与粘贴。 */
export const InputOTP: Component<InputOTPProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'maxLength', 'value', 'onChange', 'disabled', 'children']);
  const [internalValue, setInternalValue] = createSignal('');
  const [activeIndex, setActiveIndex] = createSignal(-1);
  const slotElements = new Map<number, HTMLInputElement>();

  const value = createMemo(() => (local.value ?? internalValue()).slice(0, local.maxLength));
  const disabled = () => local.disabled ?? false;
  const maxLength = () => local.maxLength;

  const commitValue = (next: string) => {
    const trimmed = next.slice(0, maxLength());
    if (local.value === undefined) {
      setInternalValue(trimmed);
    }
    local.onChange?.(trimmed);
  };

  const setChar = (index: number, char: string) => {
    const chars = value().split('');
    if (index >= chars.length) {
      while (chars.length < index) chars.push('');
      chars.push(char);
    } else {
      chars[index] = char;
    }
    commitValue(chars.join('').slice(0, maxLength()));
  };

  const removeChar = (index: number) => {
    const chars = value().split('');
    if (index >= chars.length) return;
    chars.splice(index, 1);
    commitValue(chars.join(''));
  };

  const focusSlot = (index: number) => {
    const clamped = Math.max(0, Math.min(index, maxLength() - 1));
    setActiveIndex(clamped);
    slotElements.get(clamped)?.focus();
  };

  const registerSlot = (index: number, element: HTMLInputElement) => {
    slotElements.set(index, element);
  };

  const context: InputOTPContextValue = {
    value,
    maxLength,
    disabled,
    setChar,
    removeChar,
    focusSlot,
    registerSlot,
    isActive: (index) => activeIndex() === index,
    setActiveIndex,
  };

  const onPaste = (event: ClipboardEvent) => {
    if (disabled()) return;
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    const digits = pasted.replace(/\s/g, '').slice(0, maxLength());
    if (!digits) return;
    commitValue(digits);
    focusSlot(Math.min(digits.length, maxLength() - 1));
  };

  return (
    <InputOTPContext.Provider value={context}>
      <div
        data-slot="input-otp"
        class={cn('flex items-center gap-8', local.class)}
        onPaste={onPaste}
        {...rest}
      >
        {local.children}
      </div>
    </InputOTPContext.Provider>
  );
};

/** OTP 字符槽位分组容器。 */
export const InputOTPGroup: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="input-otp-group"
      class={cn('flex items-center gap-6', local.class)}
      {...rest}
    />
  );
};

type InputOTPSlotProps = Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  index: number;
};

/** 单个 OTP 字符输入槽。 */
export const InputOTPSlot: Component<InputOTPSlotProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'index']);
  const context = useInputOTPContext('InputOTPSlot');
  const char = () => context.value()[local.index] ?? '';
  const isDisabled = () => context.disabled();

  const onInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    if (isDisabled()) return;
    const input = event.currentTarget;
    const next = input.value.replace(/\s/g, '');
    if (!next) {
      context.removeChar(local.index);
      return;
    }
    const digit = next.slice(-1);
    context.setChar(local.index, digit);
    if (local.index < context.maxLength() - 1) {
      context.focusSlot(local.index + 1);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isDisabled()) return;
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (char()) {
        context.removeChar(local.index);
      } else if (local.index > 0) {
        context.focusSlot(local.index - 1);
        context.removeChar(local.index - 1);
      }
      return;
    }
    if (event.key === 'ArrowLeft' && local.index > 0) {
      event.preventDefault();
      context.focusSlot(local.index - 1);
      return;
    }
    if (event.key === 'ArrowRight' && local.index < context.maxLength() - 1) {
      event.preventDefault();
      context.focusSlot(local.index + 1);
      return;
    }
  };

  const onFocus = () => {
    context.setActiveIndex(local.index);
  };

  return (
    <input
      {...rest}
      data-slot="input-otp-slot"
      data-index={local.index}
      type="text"
      inputMode="numeric"
      autocomplete="one-time-code"
      maxLength={1}
      value={char()}
      disabled={isDisabled()}
      aria-label={`Character ${local.index + 1}`}
      class={cn(slotInputClasses(context.isActive(local.index), isDisabled()), local.class)}
      ref={(node) => context.registerSlot(local.index, node)}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    />
  );
};

/** OTP 分组之间的分隔符。 */
export const InputOTPSeparator: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="input-otp-separator"
      role="separator"
      aria-hidden="true"
      class={cn('text-13 text-text-muted', local.class)}
      {...rest}
    >
      -
    </div>
  );
};
