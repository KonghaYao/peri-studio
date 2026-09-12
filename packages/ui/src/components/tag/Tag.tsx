import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-solid';
import {
  createSignal,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../../lib/cn';

const PRESET_COLORS = new Set([
  'success',
  'warning',
  'danger',
  'info',
  'neutral',
  'processing',
  'error',
  'default',
]);

const tagVariants = cva(
  'inline-flex max-w-full items-center gap-4 rounded-4 border px-8 py-2 text-12 font-medium transition-colors',
  {
    variants: {
      variant: {
        filled: 'border-transparent bg-surface-muted text-content-primary',
        outlined: 'border-border-strong bg-transparent text-content-primary',
        solid: 'border-transparent text-white',
      },
      color: {
        default: '',
        success: '',
        warning: '',
        danger: '',
        info: '',
        neutral: '',
        processing: '',
        error: '',
      },
    },
    compoundVariants: [
      { variant: 'filled', color: 'success', class: 'bg-success-soft text-success-solid' },
      { variant: 'filled', color: 'warning', class: 'bg-warning-soft text-warning-solid' },
      { variant: 'filled', color: 'danger', class: 'bg-danger-soft text-danger-solid' },
      { variant: 'filled', color: 'error', class: 'bg-danger-soft text-danger-solid' },
      { variant: 'filled', color: 'info', class: 'bg-accent-soft text-accent-solid' },
      { variant: 'filled', color: 'processing', class: 'bg-accent-soft text-accent-solid' },
      { variant: 'outlined', color: 'success', class: 'border-success text-success-solid' },
      { variant: 'outlined', color: 'warning', class: 'border-warning text-warning-solid' },
      { variant: 'outlined', color: 'danger', class: 'border-danger text-danger-solid' },
      { variant: 'outlined', color: 'error', class: 'border-danger text-danger-solid' },
      { variant: 'outlined', color: 'info', class: 'border-accent text-accent-solid' },
      { variant: 'solid', color: 'success', class: 'bg-success text-white' },
      { variant: 'solid', color: 'warning', class: 'bg-warning text-white' },
      { variant: 'solid', color: 'danger', class: 'bg-danger text-white' },
      { variant: 'solid', color: 'error', class: 'bg-danger text-white' },
      { variant: 'solid', color: 'info', class: 'bg-accent-solid text-white' },
    ],
    defaultVariants: {
      variant: 'filled',
      color: 'default',
    },
  },
);

type TagVariantProps = VariantProps<typeof tagVariants>;

export type TagProps = ComponentProps<'span'> &
  TagVariantProps & {
    icon?: JSX.Element;
    closable?: boolean;
    onClose?: (event: MouseEvent) => void;
    closeIcon?: JSX.Element;
    checked?: boolean;
    onChange?: (checked: boolean) => void;
  };

function resolveColor(color?: string): TagVariantProps['color'] {
  if (!color) return 'default';
  if (PRESET_COLORS.has(color)) return color as TagVariantProps['color'];
  return 'default';
}

/** 标签：预设色、可关闭、可勾选。 */
export const Tag: Component<TagProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'icon',
    'closable',
    'onClose',
    'closeIcon',
    'variant',
    'color',
    'checked',
    'onChange',
    'style',
  ]);
  const [visible, setVisible] = createSignal(true);
  const checkable = () => local.onChange !== undefined || local.checked !== undefined;
  const color = () => resolveColor(local.color as string | undefined);

  const close = (event: MouseEvent) => {
    event.stopPropagation();
    local.onClose?.(event);
    if (!event.defaultPrevented) setVisible(false);
  };

  const toggle = () => {
    if (!checkable()) return;
    local.onChange?.(!local.checked);
  };

  return (
    <Show when={visible()}>
      <span
        data-slot="tag"
        data-checkable={checkable() ? '' : undefined}
        data-checked={checkable() && local.checked ? '' : undefined}
        role={checkable() ? 'checkbox' : undefined}
        aria-checked={checkable() ? !!local.checked : undefined}
        tabIndex={checkable() ? 0 : undefined}
        onClick={checkable() ? toggle : undefined}
        onKeyDown={checkable()
          ? (event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                toggle();
              }
            }
          : undefined}
        class={cn(
          tagVariants({ variant: local.variant, color: color() }),
          checkable() && 'cursor-pointer select-none',
          checkable() && local.checked && 'border-accent bg-accent-soft text-accent-solid',
          local.class,
        )}
        style={!PRESET_COLORS.has(String(local.color)) && local.color
          ? { ...((local.style as object) ?? {}), 'border-color': local.color, color: local.color }
          : local.style}
        {...rest}
      >
        <Show when={local.icon}>
          <span class="shrink-0" aria-hidden="true">{local.icon}</span>
        </Show>
        <span class="truncate">{local.children}</span>
        <Show when={local.closable}>
          <button
            type="button"
            class="ml-2 inline-flex shrink-0 rounded-2 text-content-muted hover:text-content-primary"
            aria-label="Remove tag"
            onClick={close}
          >
            {local.closeIcon ?? <X size={12} strokeWidth={2} />}
          </button>
        </Show>
      </span>
    </Show>
  );
};

export type CheckableTagProps = Omit<TagProps, 'closable' | 'onClose'>;

export const CheckableTag: Component<CheckableTagProps> = (props) => (
  <Tag {...props} onChange={props.onChange ?? (() => undefined)} />
);
