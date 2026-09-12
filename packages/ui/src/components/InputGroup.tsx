import { cva, type VariantProps } from 'class-variance-authority';
import { splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';

/** 输入组容器：统一边框与 focus-within 高亮，addon 与输入共享一行。 */
export const InputGroup: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="input-group"
      class={cn(
        'group/input-group flex h-32 w-full items-center overflow-hidden rounded-6 border border-border-strong bg-surface ui-control-transition',
        'focus-within:border-focus-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45',
        local.class,
      )}
      {...rest}
    />
  );
};

const inputGroupAddonVariants = cva(
  'flex shrink-0 cursor-text select-none items-center justify-center px-12 text-13 text-content-muted',
  {
    variants: {
      align: {
        'inline-start': 'order-first',
        'inline-end': 'order-last',
      },
    },
    defaultVariants: { align: 'inline-start' },
  },
);

type AddonAlign = NonNullable<VariantProps<typeof inputGroupAddonVariants>['align']>;

/** addon 槽位：默认 inline-start；DOM 顺序应在 input 之后以便焦点管理。 */
export function InputGroupAddon(
  props: ComponentProps<'div'> & { align?: AddonAlign },
) {
  const [local, rest] = splitProps(props, ['class', 'align']);
  const align = () => local.align ?? 'inline-start';
  return (
    <div
      data-slot="input-group-addon"
      data-align={align()}
      class={cn(inputGroupAddonVariants({ align: align() }), local.class)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        event.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
      {...rest}
    />
  );
}

/** 组内按钮段：IconButton 尺寸，ghost 无边框。 */
export function InputGroupButton(
  props: Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
    size?: 'sm' | 'md';
  },
) {
  const [local, rest] = splitProps(props, ['class', 'size']);
  return (
    <Button
      variant="ghost"
      size={local.size ?? 'sm'}
      data-slot="input-group-button"
      class={cn('shrink-0 shadow-none', local.class)}
      {...rest}
    />
  );
}

/** 组内静态文案 addon。 */
export function InputGroupText(props: ComponentProps<'span'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <span
      data-slot="input-group-text"
      class={cn('text-13 text-content-muted', local.class)}
      {...rest}
    />
  );
}

/** 组内无边框输入：边框由 InputGroup 容器承担。 */
export function InputGroupInput(
  props: JSX.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean },
) {
  const [local, input] = splitProps(props, ['class', 'invalid']);
  return (
    <input
      {...input}
      data-slot="input-group-input"
      aria-invalid={local.invalid ? 'true' : undefined}
      class={cn(
        'box-border h-full min-w-0 flex-1 border-0 bg-transparent px-12 text-13 text-text-primary outline-none',
        'placeholder:text-text-faint',
        'disabled:cursor-not-allowed disabled:text-text-muted',
        local.class,
      )}
    />
  );
}
