import { File, Folder } from 'lucide-solid';
import { createSignal, onMount } from 'solid-js';
import { cn } from '@/lib/catalog-ui';

/** 行内新建 / 重命名编辑器（与树行同高、同缩进）。 */
export function FileTreeInlineNameEditor(props: {
  depth: number;
  kind: 'file' | 'folder';
  mode: 'create' | 'rename';
  initialValue?: string;
  placeholder?: string;
  invalid?: boolean;
  errorMessage?: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  const [value, setValue] = createSignal(props.initialValue ?? '');

  onMount(() => {
    inputRef?.focus();
    if (props.mode === 'rename' && props.initialValue) {
      inputRef?.select();
    }
  });

  const paddingLeft = () => `calc(6px + ${props.depth} * 12px)`;

  const handleKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      props.onCommit(value());
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      props.onCancel();
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <div
        class={cn(
          'explorer-mutation-inline-row flex w-full items-center gap-6 rounded-md pr-8',
          props.invalid && 'explorer-mutation-inline-row--invalid',
        )}
        style={{ 'min-height': 'var(--resource-tree-row)', 'padding-left': paddingLeft() }}
      >
        {props.kind === 'folder'
          ? <Folder size={14} class="shrink-0 text-content-muted" />
          : <File size={14} class="shrink-0 text-content-muted" />}
        <input
          ref={(el) => {
            inputRef = el;
          }}
          class={cn(
            'h-(--control-height-sm) min-w-0 flex-1 rounded-md border bg-surface-overlay px-8 text-12 text-content-primary outline-none transition-colors duration-(--duration-fast)',
            'placeholder:text-content-faint',
            props.invalid
              ? 'border-danger-solid focus:border-danger-solid'
              : 'border-border-strong hover:border-accent-border-hover focus:border-border-focus',
          )}
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={props.placeholder}
          aria-invalid={props.invalid || undefined}
          aria-label={props.ariaLabel}
        />
      </div>
      {props.invalid && props.errorMessage && (
        <p class="pl-8 text-11 text-danger-solid" role="alert">
          {props.errorMessage}
        </p>
      )}
    </div>
  );
}
