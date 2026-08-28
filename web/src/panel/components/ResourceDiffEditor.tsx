import { For, Show, createMemo, onCleanup, onMount } from 'solid-js';
import { Button, IconButton, LoadingState } from '../../components/ui';
import { X } from 'lucide-solid';
import { closeResourceDiffPreview, refreshResourceProject, resourceDiffPreview, retryGitDiffPreview } from '../store';
import { MAX_RENDERED_DIFF_ROWS, parseUnifiedDiff, type DiffRow } from '../lib/resource-diff';

function CloseIcon() {
  return <X size={15} strokeWidth={1.7} />;
}

type ResourceDiffEditorProps = { onClose?: () => void };

export function ResourceDiffEditor(props: ResourceDiffEditorProps = {}) {
  const preview = resourceDiffPreview;
  const close = () => props.onClose ? props.onClose() : closeResourceDiffPreview();
  const parsed = createMemo(() => parseUnifiedDiff(preview()?.text ?? ''));
  const comparison = createMemo(() => ({
    conflicts: 'Merge changes',
    index: 'HEAD ↔ Index',
    working_tree: 'Index ↔ Working Tree',
    untracked: 'New file',
  }[preview()?.groupId ?? 'working_tree']));
  const accessibleTitle = () => `Git diff: ${preview()?.path ?? 'file'}, ${comparison()}`;

  onMount(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      // Escape 只关闭最上层交互。确认弹窗由 Dialog 自己消费第一次 Escape；
      // 底层 diff 必须保持，等待用户再次明确关闭。
      if (event.key === 'Escape' && resourceDiffPreview() && !document.querySelector('[data-dialog-overlay]')) close();
    };
    window.addEventListener('keydown', closeOnEscape);
    onCleanup(() => window.removeEventListener('keydown', closeOnEscape));
  });

  return <section class="flex h-full min-h-0 flex-col bg-surface" aria-label={accessibleTitle()}>
    <header class="resource-editor-tab flex h-35 shrink-0 items-center border-b border-divider bg-sidebar-bg pointer-coarse:h-44">
      <div class="flex h-full min-w-0 items-center gap-7 border-r border-divider border-t-2 border-t-accent bg-surface pl-12 pr-5 text-12">
        <h1 data-resource-preview-focus tabIndex={-1} aria-label={accessibleTitle()} class="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-550 text-text-primary outline-none">{basename(preview()?.path ?? '')}</h1>
        <span class="font-mono text-10 font-650 text-warning">{statusLetter(preview()?.status ?? '')}</span>
        <IconButton label="Close diff" size="compact" onClick={close} class="border-0 bg-transparent text-text-muted"><CloseIcon /></IconButton>
      </div>
    </header>
    <div class="resource-editor-toolbar flex h-34 shrink-0 items-center gap-8 border-b border-divider px-12 text-11">
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary" title={preview()?.path}>{preview()?.path}</span>
      <Show when={preview()?.originalPath}><span class="text-text-secondary">← {preview()?.originalPath}</span></Show>
      <span class="ml-auto shrink-0 text-text-muted">{comparison()}</span>
    </div>

    <Show when={!preview()?.loading} fallback={<LoadingState label="Loading changes" class="m-auto" />}>
      <Show when={!preview()?.error} fallback={
        <div class="m-auto max-w-420 rounded-8 border border-danger-border bg-danger-soft p-16 text-center">
          <p role="alert" class="m-0 text-12 leading-18 text-danger">{preview()?.error}</p>
          <div class="mt-12 flex justify-center gap-7">
            <Show when={preview()?.errorCode === 'VERSION_CONFLICT'} fallback={
              <Show when={preview()?.retryable !== false}><Button size="compact" variant="secondary" onClick={retryGitDiffPreview}>Try again</Button></Show>
            }>
              <Button size="compact" variant="secondary" onClick={refreshResourceProject}>Refresh Source Control</Button>
            </Show>
            <Button size="compact" onClick={close}>Close</Button>
          </div>
        </div>
      }>
        <Show when={!parsed().binary} fallback={<EmptyDiff title="Binary file" detail="Binary files cannot be compared in the text diff viewer." />}>
          <Show when={parsed().hunks.length > 0} fallback={<EmptyDiff title="No textual changes" detail="The file has no line changes to display." />}>
            <Show when={parsed().truncated}><div role="status" class="shrink-0 border-b border-warning-border bg-warning-soft px-12 py-6 text-11 text-warning-strong">Preview limited to the first {MAX_RENDERED_DIFF_ROWS.toLocaleString()} rows to keep the editor responsive.</div></Show>
            <div class="ui-scrollbar min-h-0 flex-1 overflow-auto" role="table" aria-label={`Changes in ${preview()?.path ?? 'file'}`}>
              <div class="min-w-[720px] font-mono text-11 leading-18">
                <For each={parsed().hunks}>{(hunk) => <section role="rowgroup">
                  <div role="row" class="grid grid-cols-2 border-b border-divider bg-selected text-accent">
                    <div role="cell" class="px-10 py-3">{hunk.header}</div>
                    <div role="cell" class="border-l border-divider px-10 py-3">{hunk.header}</div>
                  </div>
                  <For each={hunk.rows}>{(row) => <DiffLine row={row} />}</For>
                </section>}</For>
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </Show>
  </section>;
}

function DiffLine(props: { row: DiffRow }) {
  const leftChanged = () => props.row.kind === 'change' && props.row.leftText !== undefined;
  const rightChanged = () => props.row.kind === 'change' && props.row.rightText !== undefined;
  return <div role="row" class="grid min-h-18 grid-cols-2 border-b border-divider/50">
    <DiffCell number={props.row.leftNumber} text={props.row.leftText} changed={leftChanged()} side="left" />
    <DiffCell number={props.row.rightNumber} text={props.row.rightText} changed={rightChanged()} side="right" />
  </div>;
}

function DiffCell(props: { number?: number; text?: string; changed: boolean; side: 'left' | 'right' }) {
  const tone = () => props.changed
    ? props.side === 'left' ? 'border-l-2 border-danger bg-danger-soft' : 'border-l-2 border-success bg-success-soft'
    : props.text === undefined ? 'bg-surface-muted' : 'border-l-2 border-transparent';
  return <div role="cell" class={`grid min-w-0 grid-cols-[48px_minmax(0,1fr)] ${props.side === 'right' ? 'border-l border-divider' : ''} ${tone()}`}>
    <span class="select-none border-r border-divider px-7 text-right tabular-nums text-text-faint" aria-hidden="true">{props.number ?? ''}</span>
    <code class="overflow-visible whitespace-pre rounded-none bg-transparent px-8 py-0 text-text-primary [tab-size:4]">{props.text ?? ''}</code>
  </div>;
}

function EmptyDiff(props: { title: string; detail: string }) {
  return <div class="m-auto text-center">
    <strong class="block text-13 font-550 text-text-primary">{props.title}</strong>
    <p class="mt-5 text-11 text-text-muted">{props.detail}</p>
  </div>;
}

const basename = (path: string) => path.split('/').at(-1) || path;
const statusLetter = (status: string) => ({ added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U', conflict: '!' }[status] ?? 'M');
