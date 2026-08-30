import { For, Show } from 'solid-js';
import { CodeXml, FileImage, X } from 'lucide-solid';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';

export type PreviewLine = { kind: 'plain' | 'add' | 'del'; text: string };

function basename(path: string) {
  return path.split('/').at(-1) ?? path;
}

/** 文件 / diff 预览面板：Workbench 左侧主内容区。 */
export function FilePreviewPanel(props: {
  path: string;
  mode: 'text' | 'diff' | 'image';
  lines?: PreviewLine[];
  imageAlt?: string;
  readOnly?: boolean;
  onClose?: () => void;
  class?: string;
}) {
  const title = () => basename(props.path);

  return (
    <div class={cn('flex h-full min-h-0 flex-col bg-surface-overlay', props.class)} aria-label={`Preview: ${props.path}`}>
      <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span class="grid size-7 place-items-center rounded-md bg-surface-muted text-content-muted">
          {props.mode === 'image' ? <FileImage size={14} strokeWidth={1.8} /> : <CodeXml size={14} strokeWidth={1.8} />}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-12 font-medium text-content-primary">{title()}</p>
          <p class="truncate text-10 text-content-muted">{props.path}</p>
        </div>
        <Show when={props.readOnly}>
          <span class="shrink-0 text-10 text-content-muted">Read-only</span>
        </Show>
        <Show when={props.onClose}>
          <IconButton size="sm" label="Close preview" class="border-0 bg-transparent text-content-muted hover:bg-interaction-hover" onClick={props.onClose}>
            <X size={14} strokeWidth={1.8} />
          </IconButton>
        </Show>
      </header>

      <Show
        when={props.mode !== 'image'}
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center bg-surface-muted p-6 text-center text-12 text-content-muted">
            Image preview placeholder
            <Show when={props.imageAlt}>
              <span class="mt-1 block text-10">{props.imageAlt}</span>
            </Show>
          </div>
        }
      >
        <div class="min-h-0 flex-1 overflow-auto" role="region" aria-label={`Contents of ${props.path}`}>
          <div class="min-w-max py-1 font-mono text-11 leading-[18px]">
            <For each={props.lines ?? []}>
              {(line, index) => (
                <div
                  class={cn(
                    'grid min-h-[18px] grid-cols-[44px_minmax(0,1fr)]',
                    line.kind === 'add' && 'bg-success-soft text-success-strong',
                    line.kind === 'del' && 'bg-danger-soft text-danger-strong',
                    line.kind === 'plain' && 'text-content-primary',
                  )}
                >
                  <span class="select-none border-r border-border-subtle bg-surface-overlay px-2 text-right tabular-nums text-content-faint" aria-hidden="true">
                    {props.mode === 'text' ? index() + 1 : ''}
                  </span>
                  <code class="whitespace-pre px-2.5 [tab-size:4]">{line.text || ' '}</code>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
