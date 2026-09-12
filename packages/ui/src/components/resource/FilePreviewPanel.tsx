import { CodeXml, FileImage, X } from 'lucide-solid';
import { For, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';

export type PreviewLine = { kind: 'plain' | 'add' | 'del'; text: string };

function basename(path: string) {
  return path.split('/').at(-1) ?? path;
}

export type FilePreviewPanelProps = {
  path: string;
  mode: 'text' | 'diff' | 'image';
  lines?: PreviewLine[];
  imageAlt?: string;
  readOnly?: boolean;
  /** 为 false 时隐藏内置标题栏（外层已有 chrome 时使用）。默认 true。 */
  showHeader?: boolean;
  onClose?: () => void;
  class?: string;
};

/** 文件 / diff 预览面板：Workbench 左侧主内容区。 */
export const FilePreviewPanel: Component<FilePreviewPanelProps> = (props) => {
  const [local] = splitProps(props, ['path', 'mode', 'lines', 'imageAlt', 'readOnly', 'showHeader', 'onClose', 'class']);
  const title = () => basename(local.path);
  const showHeader = () => local.showHeader ?? true;

  return (
    <div
      data-slot="file-preview-panel"
      class={cn('flex h-full min-h-0 flex-col bg-surface-overlay', local.class)}
      aria-label={`Preview: ${local.path}`}
    >
      <Show when={showHeader()}>
        <header class="flex h-36 shrink-0 items-center gap-8 border-b border-border-subtle px-12">
          <span class="grid size-28 place-items-center rounded-md bg-surface-muted text-content-muted">
            {local.mode === 'image' ? <FileImage size={14} strokeWidth={1.8} /> : <CodeXml size={14} strokeWidth={1.8} />}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-12 font-medium text-content-primary">{title()}</p>
            <p class="truncate text-10 text-content-muted">{local.path}</p>
          </div>
          <Show when={local.readOnly}>
            <span class="shrink-0 text-10 text-content-muted">Read-only</span>
          </Show>
          <Show when={local.onClose}>
            <IconButton
              size="sm"
              label="Close preview"
              class="border-0 bg-transparent text-content-muted hover:bg-interaction-hover"
              onClick={local.onClose}
            >
              <X size={14} strokeWidth={1.8} />
            </IconButton>
          </Show>
        </header>
      </Show>

      <Show
        when={local.mode !== 'image'}
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center bg-surface-muted p-24 text-center text-12 text-content-muted">
            Image preview placeholder
            <Show when={local.imageAlt}>
              <span class="mt-4 block text-10">{local.imageAlt}</span>
            </Show>
          </div>
        }
      >
        <div class="min-h-0 flex-1 overflow-auto" role="region" aria-label={`Contents of ${local.path}`}>
          <div class="ui-file-preview-code min-w-max py-4 font-mono text-11">
            <For each={local.lines ?? []}>
              {(line, index) => (
                <div
                  class={cn(
                    'grid min-h-18 grid-cols-preview-line',
                    line.kind === 'add' && 'bg-success-soft text-success-strong',
                    line.kind === 'del' && 'bg-danger-soft text-danger-strong',
                    line.kind === 'plain' && 'text-content-primary',
                  )}
                >
                  <span class="select-none border-r border-border-subtle bg-surface-overlay px-8 text-right tabular-nums text-content-faint" aria-hidden="true">
                    {local.mode === 'text' ? index() + 1 : ''}
                  </span>
                  <code class="code-tab-size whitespace-pre px-10">{line.text || ' '}</code>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};
