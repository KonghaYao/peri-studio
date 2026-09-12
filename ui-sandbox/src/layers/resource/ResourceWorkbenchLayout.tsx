import { createSignal, Show } from 'solid-js';
import { Files, GitBranch, X } from 'lucide-solid';
import { IconButton } from '@/lib/catalog-ui';
import { cn } from '@/lib/catalog-ui';
import { DEMO_STAGED, DEMO_UNTRACKED, DEMO_WORKING } from './git-demo-data';
import { SourceControlLayout } from './SourceControlLayout';
import { WorkbenchExplorerLayout } from './WorkbenchExplorerLayout';
import { WorkbenchPreviewLayout } from './WorkbenchPreviewLayout';
import { DEFAULT_WORKBENCH_PREVIEW, type WorkbenchPreview } from './workbench-preview-data';

type WorkbenchView = 'explorer' | 'scm';

function RailButton(props: {
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  children: unknown;
}) {
  return (
    <IconButton
      label={props.label}
      onClick={props.onClick}
      class={cn(
        'relative w-full min-h-36 rounded-md border-0 bg-transparent text-content-muted',
        props.active && 'bg-sidebar-selected text-content-primary before:absolute before:top-6 before:bottom-6 before:-right-3 before:w-2 before:rounded-full before:bg-accent-solid',
      )}
    >
      {props.children as never}
      <Show when={(props.badge ?? 0) > 0}>
        <span class="absolute right-2 bottom-2 min-w-14 rounded-full bg-accent-solid px-4 text-center text-9 leading-none text-content-on-accent">
          {props.badge! > 99 ? '99+' : props.badge}
        </span>
      </Show>
    </IconButton>
  );
}

function panelTitle(view: WorkbenchView) {
  return view === 'explorer' ? 'Explorer' : 'Source Control';
}

/** Tier 4 · Workbench：左侧预览 + 右侧 Explorer / SCM 浮层与 rail。 */
export function ResourceWorkbenchLayout() {
  const [view, setView] = createSignal<WorkbenchView>('explorer');
  const [preview, setPreview] = createSignal<WorkbenchPreview>(DEFAULT_WORKBENCH_PREVIEW);
  const scmCount = () => DEMO_STAGED.length + DEMO_WORKING.length + DEMO_UNTRACKED.length;

  const openFilePreview = (path: string) => setPreview({ kind: 'file', path });
  const openDiffPreview = (path: string) => setPreview({ kind: 'diff', path });

  return (
    <div
      class="flex h-(--workbench-frame-height) w-full overflow-hidden rounded-lg border border-border-subtle bg-surface-canvas"
      aria-label="Resource workbench"
    >
      <section class="min-w-0 flex-1 overflow-hidden" aria-label="File preview">
        <WorkbenchPreviewLayout preview={preview()} />
      </section>

      <div class="flex shrink-0 border-l border-border-subtle">
        <div
          class="flex h-full w-(--workbench-panel-width) flex-col overflow-hidden bg-surface-overlay"
        >
          <header class="flex h-32 shrink-0 items-center gap-4 border-b border-border-subtle px-10">
            <span class="min-w-0 flex-1 truncate text-10 font-semibold tracking-wide uppercase text-content-muted">
              {panelTitle(view())}
            </span>
            <IconButton size="sm" label="Close panel" class="border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary">
              <X size={14} strokeWidth={1.8} />
            </IconButton>
          </header>
          <div class="min-h-0 flex-1 overflow-hidden">
            <Show when={view() === 'explorer'}>
              <WorkbenchExplorerLayout
                selectedPath={preview().kind === 'file' ? preview().path : ''}
                onSelectPath={openFilePreview}
              />
            </Show>
            <Show when={view() === 'scm'}>
              <SourceControlLayout embedded onPreviewPath={openDiffPreview} />
            </Show>
          </div>
        </div>
        <nav
          class="flex w-(--workbench-rail-width) shrink-0 flex-col items-center gap-4 border-l border-border-subtle py-8"
          aria-label="Resource views"
        >
          <RailButton label="Explorer" active={view() === 'explorer'} onClick={() => setView('explorer')}>
            <Files size={17} strokeWidth={1.7} />
          </RailButton>
          <RailButton label="Source Control" active={view() === 'scm'} badge={scmCount()} onClick={() => setView('scm')}>
            <GitBranch size={17} strokeWidth={1.7} />
          </RailButton>
        </nav>
      </div>
    </div>
  );
}
