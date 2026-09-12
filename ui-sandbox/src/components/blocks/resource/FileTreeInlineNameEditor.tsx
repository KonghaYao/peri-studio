import { VSCodeFileIcon } from '@peri/ui';
import { createSignal, onMount, Show } from 'solid-js';
import { cn } from '@/lib/catalog-ui';

function rowPadding(depth: number) {
  return { 'padding-left': `${7 + depth * 12}px` };
}

function errorInset(depth: number, kind: 'file' | 'folder') {
  const leadingInset = kind === 'file' ? 6 : 0;
  const gap = kind === 'folder' ? 4 : 5;
  return `${7 + depth * 12 + leadingInset + 16 + gap}px`;
}

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
    <div
      class={cn(
        'group/tree-file relative flex h-(--tree-row-height) w-full items-center rounded-4 bg-selected pr-5 text-11 pointer-coarse:h-44',
        props.invalid && 'explorer-mutation-inline-row--invalid',
      )}
      style={rowPadding(props.depth)}
    >
      <div
        class={cn(
          'flex h-full min-w-0 flex-1 items-center rounded-4',
          props.kind === 'folder' ? 'gap-4' : 'gap-5 pl-6',
        )}
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
            'file-tree-inline-name-input min-w-0 flex-1',
            props.kind === 'folder' && 'font-600',
          )}
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={props.placeholder}
          aria-invalid={props.invalid || undefined}
          aria-label={props.ariaLabel}
        />
      </div>
      <Show when={props.invalid && props.errorMessage}>
        <p
          class="file-tree-inline-name-error"
          role="alert"
          style={{ 'padding-left': errorInset(props.depth, props.kind) }}
        >
          {props.errorMessage}
        </p>
      </Show>
    </div>
  );
}
