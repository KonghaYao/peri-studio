import { VSCodeFileIcon } from '@peri/ui';
import { createSignal, onMount } from 'solid-js';
import { cn } from '@/lib/catalog-ui';

/** 行内新建 / 重命名编辑器（与 FileTree 行同高、同缩进、同图标）。 */
export function FileTreeInlineNameEditor(props: {
  depth: number;
  kind: 'file' | 'folder';
  path?: string;
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
  const iconPath = () => props.path ?? (props.kind === 'folder' ? 'folder' : 'untitled.txt');

  onMount(() => {
    inputRef?.focus();
    if (props.mode === 'rename' && props.initialValue) {
      inputRef?.select();
    }
  });

  const paddingLeft = () => `${7 + props.depth * 12}px`;

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
          'explorer-mutation-inline-row flex w-full items-center gap-5 rounded-4 pr-5',
          props.invalid && 'explorer-mutation-inline-row--invalid',
        )}
        style={{ 'min-height': 'var(--tree-row-height)', 'padding-left': paddingLeft() }}
      >
        <VSCodeFileIcon
          path={iconPath()}
          directory={props.kind === 'folder'}
          size={16}
          class="size-16 shrink-0"
        />
        <input
          ref={(el) => {
            inputRef = el;
          }}
          class={cn(
            'h-(--control-height-sm) min-w-0 flex-1 rounded-md border bg-surface-overlay px-8 text-11 text-content-primary outline-none transition-colors duration-(--duration-fast)',
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
