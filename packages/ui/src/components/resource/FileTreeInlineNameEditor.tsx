import { createSignal, onMount, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  fileTreeInlineNameErrorClass,
  fileTreeInlineNameInputClass,
  fileTreeInlineRowInvalidClass,
} from './file-tree-layout';
import { VSCodeFileIcon } from '../VSCodeFileIcon';

function rowPadding(depth: number) {
  return { 'padding-left': `${7 + depth * 12}px` };
}

function errorInset(depth: number, kind: 'file' | 'folder') {
  const leadingInset = kind === 'file' ? 6 : 0;
  const gap = kind === 'folder' ? 4 : 5;
  return `${7 + depth * 12 + leadingInset + 16 + gap}px`;
}

export type FileTreeInlineNameEditorProps = {
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
};

/** 行内新建 / 重命名编辑器（与 FileTree 行同高、同缩进、同图标）。 */
export const FileTreeInlineNameEditor: Component<FileTreeInlineNameEditorProps> = (props) => {
  const [local] = splitProps(props, [
    'depth',
    'kind',
    'path',
    'mode',
    'initialValue',
    'placeholder',
    'invalid',
    'errorMessage',
    'ariaLabel',
    'onCommit',
    'onCancel',
  ]);
  let inputRef: HTMLInputElement | undefined;
  const [value, setValue] = createSignal(local.initialValue ?? '');
  const iconPath = () => local.path ?? (local.kind === 'folder' ? 'folder' : 'untitled.txt');

  onMount(() => {
    inputRef?.focus();
    if (local.mode === 'rename' && local.initialValue) {
      inputRef?.select();
    }
  });

  const handleKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      local.onCommit(value());
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      local.onCancel();
    }
  };

  return (
    <div
      data-slot="file-tree-inline-name-editor"
      class={cn(
        'group/tree-file relative flex h-(--tree-row-height) w-full items-center rounded-4 bg-selected pr-5 text-11 pointer-coarse:h-44',
        local.invalid && fileTreeInlineRowInvalidClass,
      )}
      style={rowPadding(local.depth)}
    >
      <div
        class={cn(
          'flex h-full min-w-0 flex-1 items-center rounded-4',
          local.kind === 'folder' ? 'gap-4' : 'gap-5 pl-6',
        )}
      >
        <VSCodeFileIcon
          path={iconPath()}
          directory={local.kind === 'folder'}
          size={16}
          class="size-16 shrink-0"
        />
        <input
          ref={(el) => {
            inputRef = el;
          }}
          class={cn(
            fileTreeInlineNameInputClass,
            'min-w-0 flex-1',
            local.kind === 'folder' && 'font-600',
          )}
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={local.placeholder}
          aria-invalid={local.invalid || undefined}
          aria-label={local.ariaLabel}
        />
      </div>
      <Show when={local.invalid && local.errorMessage}>
        <p
          class={fileTreeInlineNameErrorClass}
          role="alert"
          style={{ 'padding-left': errorInset(local.depth, local.kind) }}
        >
          {local.errorMessage}
        </p>
      </Show>
    </div>
  );
};
