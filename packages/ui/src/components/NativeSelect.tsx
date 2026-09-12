import { ChevronDown } from 'lucide-solid';
import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

const nativeSelectControlClasses = (invalid?: boolean, className?: string) => cn(
  'box-border h-36 w-full appearance-none rounded-6 border bg-surface px-12 pr-32 text-13 text-text-primary outline-none ui-control-transition',
  invalid
    ? 'border-danger focus:border-danger'
    : 'border-border-strong hover:border-accent-border-hover focus:border-focus-ring',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted',
  className,
);

/** 原生 select，边框与焦点样式与 Field Input 对齐。 */
export function NativeSelect(props: JSX.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  const [local, select] = splitProps(props, ['class', 'invalid', 'children']);
  return (
    <div class="relative w-full">
      <select
        {...select}
        aria-invalid={local.invalid ? 'true' : undefined}
        class={nativeSelectControlClasses(!!local.invalid, local.class)}
      >
        {local.children}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.7}
        class="pointer-events-none absolute top-1/2 right-12 -translate-y-1/2 text-content-muted"
        aria-hidden="true"
      />
    </div>
  );
}

/** option 薄包装，便于与 NativeSelect 组合。 */
export function NativeSelectOption(props: JSX.OptionHTMLAttributes<HTMLOptionElement>) {
  const [local, option] = splitProps(props, ['class']);
  return <option class={local.class} {...option} />;
}
