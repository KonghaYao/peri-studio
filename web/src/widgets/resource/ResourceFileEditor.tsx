import { For, Match, Show, Switch, createMemo, onCleanup, onMount } from 'solid-js';
import { Button, DownloadIcon, IconButton, LoadingState } from '@/shared/ui';
import { X } from 'lucide-solid';
import {
  closeResourceFilePreview,
  downloadPreviewedFile,
  resourceFilePreview,
  retryResourceFilePreview,
} from '@/store';
import { RESOURCE_PANEL_HEADER_CLASS, RESOURCE_PANEL_TITLE_CLASS } from './resource-panel-layout';

function CloseIcon() {
  return <X size={15} strokeWidth={1.7} />;
}

type ResourceFileEditorProps = { onClose?: () => void; floating?: boolean };

export function ResourceFileEditor(props: ResourceFileEditorProps = {}) {
  const preview = resourceFilePreview;
  const floating = () => !!props.floating;
  const accessibleTitle = () => `File preview: ${preview()?.path ?? 'file'}`;
  const close = () => props.onClose ? props.onClose() : closeResourceFilePreview();
  const allLines = createMemo(() => (preview()?.text ?? '').replaceAll('\r\n', '\n').split('\n'));
  const lines = createMemo(() => allLines().slice(0, MAX_RENDERED_FILE_LINES));

  onMount(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && resourceFilePreview()) close();
    };
    window.addEventListener('keydown', closeOnEscape);
    onCleanup(() => window.removeEventListener('keydown', closeOnEscape));
  });

  return <section class={`flex h-full min-h-0 flex-col ${floating() ? 'bg-surface-overlay' : 'bg-surface'}`} aria-label={accessibleTitle()} data-testid="resource-file-editor">
    <Show when={floating()} fallback={
      <>
    <header data-testid="resource-editor-tab" class="resource-editor-tab flex h-35 shrink-0 items-center border-b border-divider bg-sidebar-bg pointer-coarse:h-44">
      <div class="flex h-full min-w-0 items-center gap-7 border-r border-divider border-t-2 border-t-accent bg-surface pl-12 pr-5 text-12">
        <h1 data-resource-preview-focus tabIndex={-1} aria-label={accessibleTitle()} class="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-550 text-text-primary outline-none">{basename(preview()?.path ?? '')}</h1>
        <IconButton label="Close file" size="compact" onClick={close} class="border-0 bg-transparent text-text-muted"><CloseIcon /></IconButton>
      </div>
    </header>
      </>
    }>
      <header class={RESOURCE_PANEL_HEADER_CLASS}>
        <strong
          data-resource-preview-focus
          tabIndex={-1}
          aria-label={accessibleTitle()}
          class={RESOURCE_PANEL_TITLE_CLASS}
          title={preview()?.path}
        >{basename(preview()?.path ?? '')}</strong>
        <span class="shrink-0 text-10 text-content-muted">Read-only</span>
        <Show when={preview()?.url}>
          <IconButton label="Download file" size="sm" showTooltip={false} onClick={downloadPreviewedFile} class="shrink-0 text-content-muted"><DownloadIcon /></IconButton>
        </Show>
        <IconButton label="Close file preview" size="sm" showTooltip={false} onClick={close} class="shrink-0 text-content-muted"><CloseIcon /></IconButton>
      </header>
    </Show>
    <Show when={!floating()}>
    <div data-testid="resource-editor-toolbar" class="resource-editor-toolbar flex h-34 shrink-0 items-center gap-8 border-b border-divider px-12 text-11 pointer-coarse:h-44">
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary" title={preview()?.path}>{preview()?.path}</span>
      <span class="ml-auto shrink-0 text-text-muted">Read-only</span>
      <Show when={preview()?.url}>
        <IconButton label="Download file" size="compact" onClick={downloadPreviewedFile} class="border-0 bg-transparent text-text-muted"><DownloadIcon /></IconButton>
      </Show>
    </div>
    </Show>

    <Show when={!preview()?.loading} fallback={<LoadingState label="Opening file" class="m-auto" />}>
      <Show when={!preview()?.error} fallback={
        <div class="m-auto max-w-420 rounded-8 border border-danger-border bg-danger-soft p-16 text-center">
          <p role="alert" class="m-0 text-12 leading-18 text-danger">{preview()?.error}</p>
          <div class="mt-12 flex justify-center gap-7">
            <Button size="compact" variant="secondary" onClick={retryResourceFilePreview}>Try again</Button>
            <Button size="compact" onClick={close}>Close</Button>
          </div>
        </div>
      }>
        <Switch>
          <Match when={preview()?.mode === 'text'}>
            <Show when={allLines().length > MAX_RENDERED_FILE_LINES}><div role="status" class="shrink-0 border-b border-warning-border bg-warning-soft px-12 py-6 text-11 text-warning-strong">Preview limited to the first {MAX_RENDERED_FILE_LINES.toLocaleString()} lines. Download the file to inspect all {allLines().length.toLocaleString()} lines.</div></Show>
            <div class="ui-scrollbar min-h-0 flex-1 overflow-auto" role="region" aria-label={`Contents of ${preview()?.path ?? 'file'}`}>
              <div class="min-w-max py-4 font-mono text-11 leading-18">
                <For each={lines()}>{(line, index) => <div class="grid min-h-18 grid-cols-editor-line">
                  <span class="sticky left-0 select-none border-r border-divider bg-surface px-9 text-right tabular-nums text-text-faint" aria-hidden="true">{index() + 1}</span>
                  <code class="code-tab-size whitespace-pre rounded-none bg-transparent px-10 py-0 text-text-primary">{line || ' '}</code>
                </div>}</For>
              </div>
            </div>
          </Match>
          <Match when={preview()?.mode === 'image'}>
            <div class="ui-scrollbar grid min-h-0 flex-1 place-items-center overflow-auto bg-surface-muted p-24">
              <img src={preview()?.url} alt={`Preview of ${basename(preview()?.path ?? '')}`} class="max-h-full max-w-full border border-divider bg-surface object-contain shadow-card" />
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
  </section>;
}

const MAX_RENDERED_FILE_LINES = 5_000;

function UnavailableFile(props: { title: string; detail: string }) {
  return <div class="m-auto text-center">
    <strong class="block text-13 font-550 text-text-primary">{props.title}</strong>
    <p class="mt-5 text-11 text-text-muted">{props.detail}</p>
    <Button size="compact" variant="secondary" class="mt-12" onClick={downloadPreviewedFile}><DownloadIcon />Download file</Button>
  </div>;
}

const basename = (path: string) => path.split('/').at(-1) || path;
const formatBytes = (bytes?: number) => {
  if (bytes === undefined) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
