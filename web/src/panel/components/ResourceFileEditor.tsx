import { For, Match, Show, Switch, createMemo, onCleanup, onMount } from 'solid-js';
import { Button, DownloadIcon, Icon, IconButton, LoadingState } from '../../components/ui';
import {
  closeResourceFilePreview,
  downloadPreviewedFile,
  resourceFilePreview,
  retryResourceFilePreview,
} from '../store';

function CloseIcon() {
  return <Icon size="small"><path d="m5 5 10 10M15 5 5 15" /></Icon>;
}

export function ResourceFileEditor() {
  const preview = resourceFilePreview;
  const lines = createMemo(() => (preview()?.text ?? '').replaceAll('\r\n', '\n').split('\n'));

  onMount(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && resourceFilePreview()) closeResourceFilePreview();
    };
    window.addEventListener('keydown', closeOnEscape);
    onCleanup(() => window.removeEventListener('keydown', closeOnEscape));
  });

  return <section class="flex h-full min-h-0 flex-col bg-surface" aria-label="File preview">
    <header class="flex h-35 shrink-0 items-center border-b border-divider bg-sidebar-bg">
      <div class="flex h-full min-w-0 items-center gap-7 border-r border-divider border-t-2 border-t-accent bg-surface pl-12 pr-5 text-12">
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-550 text-text-primary">{basename(preview()?.path ?? '')}</span>
        <IconButton label="Close file" onClick={closeResourceFilePreview} class="size-24 min-h-24 border-0 bg-transparent text-text-muted"><CloseIcon /></IconButton>
      </div>
    </header>
    <div class="flex h-34 shrink-0 items-center gap-8 border-b border-divider px-12 text-11">
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary" title={preview()?.path}>{preview()?.path}</span>
      <span class="ml-auto shrink-0 text-text-muted">Read-only</span>
      <Show when={preview()?.url}>
        <IconButton label="Download file" onClick={downloadPreviewedFile} class="size-26 min-h-26 border-0 bg-transparent text-text-muted"><DownloadIcon /></IconButton>
      </Show>
    </div>

    <Show when={!preview()?.loading} fallback={<LoadingState label="Opening file" class="m-auto" />}>
      <Show when={!preview()?.error} fallback={
        <div class="m-auto max-w-420 rounded-8 border border-danger-border bg-danger-soft p-16 text-center">
          <p role="alert" class="m-0 text-12 leading-18 text-danger">{preview()?.error}</p>
          <div class="mt-12 flex justify-center gap-7">
            <Button size="compact" variant="secondary" onClick={retryResourceFilePreview}>Try again</Button>
            <Button size="compact" onClick={closeResourceFilePreview}>Close</Button>
          </div>
        </div>
      }>
        <Switch>
          <Match when={preview()?.mode === 'text'}>
            <div class="ui-scrollbar min-h-0 flex-1 overflow-auto" role="region" aria-label={`Contents of ${preview()?.path ?? 'file'}`}>
              <div class="min-w-max py-4 font-mono text-11 leading-18">
                <For each={lines()}>{(line, index) => <div class="grid min-h-18 grid-cols-[54px_minmax(0,1fr)]">
                  <span class="sticky left-0 select-none border-r border-divider bg-surface px-9 text-right tabular-nums text-text-faint" aria-hidden="true">{index() + 1}</span>
                  <code class="whitespace-pre px-10 text-text-primary [tab-size:4]">{line || ' '}</code>
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
