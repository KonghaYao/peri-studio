import { Match, Show, Switch, createMemo, onCleanup, onMount } from 'solid-js';
import {
  Button,
  DownloadIcon,
  FilePreviewPanel,
  IconButton,
  InlineNotice,
  LoadingState,
  workbenchPanelChromeHeaderClass,
  workbenchPanelChromeTitleClass,
} from '@peri/ui';
import { X } from 'lucide-solid';
import {
  closeResourceFilePreview,
  downloadPreviewedFile,
  resourceFilePreview,
  retryResourceFilePreview,
} from '@/store';
function CloseIcon() {
  return <X size={15} strokeWidth={1.7} />;
}

type ResourceFileEditorProps = { onClose?: () => void };

/** 只读文件预览内容；壳层由 `ResourceFloatingPanel`（左锚浮动）提供。 */
export function ResourceFileEditor(props: ResourceFileEditorProps = {}) {
  const preview = resourceFilePreview;
  const accessibleTitle = () => `File preview: ${preview()?.path ?? 'file'}`;
  const close = () => props.onClose ? props.onClose() : closeResourceFilePreview();
  const allLines = createMemo(() => (preview()?.text ?? '').replaceAll('\r\n', '\n').split('\n'));
  const lines = createMemo(() => allLines().slice(0, MAX_RENDERED_FILE_LINES));
  const previewLines = createMemo(() => lines().map((text) => ({ kind: 'plain' as const, text })));

  onMount(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && resourceFilePreview()) close();
    };
    window.addEventListener('keydown', closeOnEscape);
    onCleanup(() => window.removeEventListener('keydown', closeOnEscape));
  });

  return (
    <section
      class="flex h-full min-h-0 flex-col bg-surface-overlay"
      aria-label={accessibleTitle()}
      data-testid="resource-file-editor"
    >
      <header class={workbenchPanelChromeHeaderClass}>
        <strong
          data-resource-preview-focus
          tabIndex={-1}
          aria-label={accessibleTitle()}
          class={workbenchPanelChromeTitleClass}
          title={preview()?.path}
        >
          {basename(preview()?.path ?? '')}
        </strong>
        <span class="shrink-0 text-10 text-content-muted">Read-only</span>
        <Show when={preview()?.url}>
          <IconButton label="Download file" size="sm" showTooltip={false} onClick={downloadPreviewedFile} class="shrink-0 text-content-muted">
            <DownloadIcon />
          </IconButton>
        </Show>
        <IconButton label="Close file preview" size="sm" showTooltip={false} onClick={close} class="shrink-0 text-content-muted">
          <CloseIcon />
        </IconButton>
      </header>

      <Show when={!preview()?.loading} fallback={<LoadingState label="Opening file" class="m-auto" />}>
        <Show
          when={!preview()?.error}
          fallback={(
            <div class="m-auto max-w-420 p-16">
              <InlineNotice tone="danger" role="alert" title="Could not open file">
                <p class="m-0">{preview()?.error}</p>
              </InlineNotice>
              <div class="mt-12 flex justify-center gap-7">
                <Button size="compact" variant="secondary" onClick={retryResourceFilePreview}>Try again</Button>
                <Button size="compact" onClick={close}>Close</Button>
              </div>
            </div>
          )}
        >
          <Switch>
            <Match when={preview()?.mode === 'text'}>
              <Show when={allLines().length > MAX_RENDERED_FILE_LINES}>
                <div role="status" class="shrink-0 border-b border-warning-border bg-warning-soft px-12 py-6 text-11 text-warning-strong">
                  Preview limited to the first {MAX_RENDERED_FILE_LINES.toLocaleString()} lines. Download the file to inspect all {allLines().length.toLocaleString()} lines.
                </div>
              </Show>
              <FilePreviewPanel
                path={preview()?.path ?? ''}
                mode="text"
                lines={previewLines()}
                showHeader={false}
                class="min-h-0 flex-1"
              />
            </Match>
            <Match when={preview()?.mode === 'image'}>
              <div class="ui-scrollbar grid min-h-0 flex-1 place-items-center overflow-auto bg-surface-muted p-24">
                <img
                  src={preview()?.url}
                  alt={`Preview of ${basename(preview()?.path ?? '')}`}
                  class="max-h-full max-w-full border border-divider bg-surface object-contain shadow-card"
                />
              </div>
            </Match>
            <Match when={preview()?.mode === 'large'}>
              <UnavailableFile title="File is too large to preview" detail={`${formatBytes(preview()?.size)} · Download it to inspect the full contents.`} />
            </Match>
            <Match when={preview()?.mode === 'binary'}>
              <UnavailableFile title="The file is not displayed in the text editor" detail={`${preview()?.contentType ?? 'Binary file'} · ${formatBytes(preview()?.size)}`} />
            </Match>
          </Switch>
        </Show>
      </Show>
    </section>
  );
}

const MAX_RENDERED_FILE_LINES = 5_000;

function UnavailableFile(props: { title: string; detail: string }) {
  return (
    <div class="m-auto text-center">
      <strong class="block text-13 font-550 text-text-primary">{props.title}</strong>
      <p class="mt-5 text-11 text-text-muted">{props.detail}</p>
      <Button size="compact" variant="secondary" class="mt-12" onClick={downloadPreviewedFile}>
        <DownloadIcon />
        Download file
      </Button>
    </div>
  );
}

const basename = (path: string) => path.split('/').at(-1) || path;
const formatBytes = (bytes?: number) => {
  if (bytes === undefined) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
